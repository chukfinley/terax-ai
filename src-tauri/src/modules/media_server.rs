//! Minimal localhost HTTP server for streaming local media to the webview.
//!
//! Why this exists: on Linux (WebKitGTK) the `<video>`/`<audio>` GStreamer
//! backend cannot decode files served through the `asset://` custom scheme,
//! and base64/blob loading is impossible for large files (e.g. multi-GB .mkv).
//! A real HTTP endpoint with byte-range support is what the media pipeline
//! understands: playback starts immediately and seeking works at any size.
//!
//! Dependency-free on purpose — the app targets a <8MB binary, so this uses
//! only `std` plus the already-present `dirs` crate. The server binds to a
//! random loopback port, is gated by a 256-bit per-process token, and only
//! serves regular files under the user's home directory.

use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

struct MediaServer {
    port: u16,
    token: String,
}

static SERVER: OnceLock<Option<MediaServer>> = OnceLock::new();

/// 256 bits of OS-seeded randomness via std's RandomState (no extra crate).
fn random_token() -> String {
    let mut s = String::with_capacity(64);
    for _ in 0..4 {
        let v = std::collections::hash_map::RandomState::new()
            .build_hasher()
            .finish();
        s.push_str(&format!("{:016x}", v));
    }
    s
}

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir().and_then(|h| std::fs::canonicalize(h).ok())
}

/// A served path must be a regular file under the user's home directory.
fn is_allowed(canon: &Path) -> bool {
    if !canon.is_file() {
        return false;
    }
    match home_dir() {
        Some(home) => canon.starts_with(home),
        None => false,
    }
}

fn ensure_server() -> Option<&'static MediaServer> {
    SERVER
        .get_or_init(|| {
            let listener = TcpListener::bind("127.0.0.1:0").ok()?;
            let port = listener.local_addr().ok()?.port();
            let token = random_token();
            let tok = token.clone();
            std::thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    let t = tok.clone();
                    std::thread::spawn(move || {
                        let _ = serve(stream, &t);
                    });
                }
            });
            Some(MediaServer { port, token })
        })
        .as_ref()
}

/// Returns an `http://127.0.0.1:<port>/<token>/<encoded-path>` URL the webview
/// can point a media element at.
#[tauri::command]
pub fn media_stream_url(path: String, workspace: Option<WorkspaceEnv>) -> Result<String, String> {
    let ws = WorkspaceEnv::from_option(workspace);
    let resolved = resolve_path(&path, &ws);
    let canon = std::fs::canonicalize(&resolved).map_err(|e| e.to_string())?;
    if !is_allowed(&canon) {
        return Err("media path is not an allowed file".into());
    }
    let srv = ensure_server().ok_or("media server unavailable")?;
    let enc = pct_encode(&canon.to_string_lossy());
    Ok(format!("http://127.0.0.1:{}/{}/{}", srv.port, srv.token, enc))
}

fn serve(stream: TcpStream, token: &str) -> std::io::Result<()> {
    if let Ok(addr) = stream.peer_addr() {
        if !addr.ip().is_loopback() {
            return Ok(());
        }
    }
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

    let mut range_header: Option<String> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some(rest) = trimmed
            .strip_prefix("Range:")
            .or_else(|| trimmed.strip_prefix("range:"))
        {
            range_header = Some(rest.trim().to_string());
        }
    }

    let mut out = stream;
    // Push bytes out without Nagle batching so seeks feel immediate.
    let _ = out.set_nodelay(true);
    if method != "GET" && method != "HEAD" {
        return write_status(&mut out, 405, "Method Not Allowed");
    }

    // target = /<token>/<percent-encoded-path>
    let after = target.trim_start_matches('/');
    let mut seg = after.splitn(2, '/');
    let got_token = seg.next().unwrap_or("");
    let enc_path = seg.next().unwrap_or("");
    if got_token != token || enc_path.is_empty() {
        return write_status(&mut out, 403, "Forbidden");
    }

    let decoded = pct_decode(enc_path);
    let canon = match std::fs::canonicalize(&decoded) {
        Ok(c) => c,
        Err(_) => return write_status(&mut out, 404, "Not Found"),
    };
    if !is_allowed(&canon) {
        return write_status(&mut out, 403, "Forbidden");
    }

    let mut file = std::fs::File::open(&canon)?;
    let size = file.metadata()?.len();
    let ctype = content_type(&canon);

    let (start, end, status) = match range_header.as_deref().and_then(|h| parse_range(h, size)) {
        Some((s, e)) => (s, e, 206u16),
        None => (0, size.saturating_sub(1), 200u16),
    };
    let length = if size == 0 { 0 } else { end - start + 1 };

    let reason = if status == 206 { "Partial Content" } else { "OK" };
    let mut head = format!("HTTP/1.1 {} {}\r\n", status, reason);
    head.push_str(&format!("Content-Type: {}\r\n", ctype));
    head.push_str("Accept-Ranges: bytes\r\n");
    head.push_str(&format!("Content-Length: {}\r\n", length));
    if status == 206 {
        head.push_str(&format!("Content-Range: bytes {}-{}/{}\r\n", start, end, size));
    }
    head.push_str("Cache-Control: no-store\r\n");
    head.push_str("Connection: close\r\n\r\n");
    out.write_all(head.as_bytes())?;

    if method == "HEAD" || length == 0 {
        return Ok(());
    }

    file.seek(SeekFrom::Start(start))?;
    let mut remaining = length;
    let mut buf = vec![0u8; 256 * 1024];
    while remaining > 0 {
        let want = remaining.min(buf.len() as u64) as usize;
        let n = file.read(&mut buf[..want])?;
        if n == 0 {
            break;
        }
        // A seek closes the current connection mid-write — swallow the error.
        if out.write_all(&buf[..n]).is_err() {
            break;
        }
        remaining -= n as u64;
    }
    Ok(())
}

fn write_status(out: &mut TcpStream, code: u16, reason: &str) -> std::io::Result<()> {
    let body = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        code, reason
    );
    out.write_all(body.as_bytes())
}

/// Parse a single-range `bytes=START-END` header (the only form media elements
/// send). Returns an inclusive (start, end) clamped to the file size.
fn parse_range(header: &str, size: u64) -> Option<(u64, u64)> {
    if size == 0 {
        return None;
    }
    let spec = header.trim().strip_prefix("bytes=")?;
    // Only the first range matters for playback.
    let spec = spec.split(',').next()?.trim();
    let (s, e) = spec.split_once('-')?;
    let (start, end) = if s.is_empty() {
        let n: u64 = e.parse().ok()?;
        let n = n.min(size);
        (size - n, size - 1)
    } else {
        let start: u64 = s.parse().ok()?;
        let end: u64 = if e.is_empty() {
            size - 1
        } else {
            e.parse().ok()?
        };
        (start, end.min(size - 1))
    };
    if start > end || start >= size {
        return None;
    }
    Some((start, end))
}

fn content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        _ => "application/octet-stream",
    }
}

fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn pct_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pct_roundtrip_handles_spaces_and_unicode() {
        let p = "/home/user/a b [x]／：.mkv";
        assert_eq!(pct_decode(&pct_encode(p)), p);
    }

    #[test]
    fn pct_encode_escapes_reserved() {
        assert_eq!(pct_encode("a b?c"), "a%20b%3Fc");
    }

    #[test]
    fn parse_range_open_ended() {
        assert_eq!(parse_range("bytes=100-", 1000), Some((100, 999)));
    }

    #[test]
    fn parse_range_explicit() {
        assert_eq!(parse_range("bytes=0-499", 1000), Some((0, 499)));
    }

    #[test]
    fn parse_range_suffix() {
        assert_eq!(parse_range("bytes=-200", 1000), Some((800, 999)));
    }

    #[test]
    fn parse_range_clamps_to_size() {
        assert_eq!(parse_range("bytes=500-99999", 1000), Some((500, 999)));
    }

    #[test]
    fn parse_range_rejects_out_of_bounds() {
        assert_eq!(parse_range("bytes=2000-3000", 1000), None);
    }
}
