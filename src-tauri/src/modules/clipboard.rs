//! Clipboard image paste for the terminal.
//!
//! When a CLI tool running inside the terminal needs a file (Claude Code,
//! Codex, etc.) the user expects to paste a screenshot and get a path. The
//! host terminal must intercept the empty paste, write the image to a temp
//! PNG, and return the path so the frontend can shell-escape it.
//!
//! Strategy: text wins. If the clipboard has any non-empty text, we return
//! `None` and let the caller fall back to a normal text paste. Image-only
//! clipboards encode to PNG (max 10 MB) and land in the OS temp directory
//! as `terax-clipboard-<unix-ms>-<pid>.png`.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_PNG_BYTES: usize = 10 * 1024 * 1024;
const CLEANUP_AGE_SECS: u64 = 24 * 60 * 60;
const FILE_PREFIX: &str = "terax-clipboard-";
const FILE_SUFFIX: &str = ".png";

#[tauri::command]
pub async fn clipboard_read_image() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(read_image_blocking)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clipboard_cleanup_temp_images() -> Result<u32, String> {
    tokio::task::spawn_blocking(cleanup_blocking)
        .await
        .map_err(|e| e.to_string())
}

fn read_image_blocking() -> Result<Option<String>, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;

    // Text wins. arboard returns Err when the clipboard has no string entry —
    // treat both empty and missing as "no text".
    if let Ok(text) = cb.get_text() {
        if !text.is_empty() {
            return Ok(None);
        }
    }

    let img = match cb.get_image() {
        Ok(img) => img,
        Err(_) => return Ok(None),
    };

    let width = u32::try_from(img.width).map_err(|_| "clipboard image width overflow".to_string())?;
    let height =
        u32::try_from(img.height).map_err(|_| "clipboard image height overflow".to_string())?;
    if width == 0 || height == 0 {
        return Ok(None);
    }

    let png = encode_rgba_to_png(&img.bytes, width, height)?;
    if png.len() > MAX_PNG_BYTES {
        return Err(format!(
            "clipboard image too large: {} bytes (max {})",
            png.len(),
            MAX_PNG_BYTES
        ));
    }

    let path = temp_png_path();
    std::fs::write(&path, &png).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn cleanup_blocking() -> u32 {
    let dir = std::env::temp_dir();
    let now = SystemTime::now();
    let mut removed: u32 = 0;
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let name_os = entry.file_name();
        let Some(name) = name_os.to_str() else { continue };
        if !name.starts_with(FILE_PREFIX) || !name.ends_with(FILE_SUFFIX) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else { continue };
        let Ok(age) = now.duration_since(modified) else { continue };
        if age.as_secs() <= CLEANUP_AGE_SECS {
            continue;
        }
        if std::fs::remove_file(entry.path()).is_ok() {
            removed = removed.saturating_add(1);
        }
    }
    removed
}

fn encode_rgba_to_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| "clipboard image dimensions overflow".to_string())?;
    if rgba.len() < expected {
        return Err(format!(
            "clipboard image data short: have {}, need {}",
            rgba.len(),
            expected
        ));
    }

    let mut out: Vec<u8> = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(&rgba[..expected])
            .map_err(|e| e.to_string())?;
    }
    Ok(out)
}

fn temp_png_path() -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let pid = std::process::id();
    let name = format!("{FILE_PREFIX}{now}-{pid}{FILE_SUFFIX}");
    std::env::temp_dir().join(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_rgba_round_trip() {
        let rgba = vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];
        let png = encode_rgba_to_png(&rgba, 2, 2).expect("encode");
        assert!(png.starts_with(&[0x89, 0x50, 0x4E, 0x47]), "PNG signature");
    }

    #[test]
    fn encode_rejects_short_buffer() {
        let rgba = vec![0u8; 4];
        let err = encode_rgba_to_png(&rgba, 2, 2).expect_err("must reject");
        assert!(err.contains("data short"), "{err}");
    }

    #[test]
    fn temp_path_uses_prefix() {
        let p = temp_png_path();
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        assert!(name.starts_with(FILE_PREFIX), "{name}");
        assert!(name.ends_with(FILE_SUFFIX), "{name}");
    }
}
