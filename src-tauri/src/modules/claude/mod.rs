//! Claude Code session bridge: locate a running `claude` session's transcript
//! JSONL and tail it so the chat GUI can mirror the interactive PTY session
//! without spawning a second `claude` process.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::ipc::Channel;

// Coalesce a burst of writes so we read the file at most once per quiet gap.
const DEBOUNCE: Duration = Duration::from_millis(60);

fn projects_root() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join(".claude")
        .join("projects"))
}

/// Claude derives the per-project directory name by replacing every byte that
/// is not ASCII-alphanumeric with `-` (so `/home/u/git/x` -> `-home-u-git-x`,
/// `.claude` -> `-claude`). Forward-encoding only; we never reverse it.
fn encode_project_dir(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Newest `.jsonl` (by mtime) in the project dir for `cwd`, if any. This is the
/// session the user is most likely interacting with right now.
#[tauri::command]
pub fn claude_find_transcript(cwd: String) -> Result<Option<String>, String> {
    let dir = projects_root()?.join(encode_project_dir(&cwd));
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("read {}: {e}", dir.display())),
    };

    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(mtime) = meta.modified() else { continue };
        if best.as_ref().is_none_or(|(t, _)| mtime > *t) {
            best = Some((mtime, path));
        }
    }
    Ok(best.map(|(_, p)| p.to_string_lossy().into_owned()))
}

fn validate_transcript_path(path: &str) -> Result<PathBuf, String> {
    let root = projects_root()?;
    let canon = std::fs::canonicalize(path).map_err(|e| format!("canonicalize: {e}"))?;
    let root_canon = std::fs::canonicalize(&root).unwrap_or(root);
    if !canon.starts_with(&root_canon) {
        return Err("path is outside ~/.claude/projects".to_string());
    }
    if canon.extension().and_then(|s| s.to_str()) != Some("jsonl") {
        return Err("not a .jsonl transcript".to_string());
    }
    Ok(canon)
}

struct TailHandle {
    stop: Arc<AtomicBool>,
    // Dropping the watcher unregisters the OS watch; kept alive for the tail's
    // lifetime.
    _watcher: RecommendedWatcher,
}

#[derive(Default)]
pub struct ClaudeState {
    tails: Mutex<HashMap<String, TailHandle>>,
}

fn stop_tail(state: &ClaudeState, key: &str) {
    if let Some(handle) = state.tails.lock().unwrap().remove(key) {
        handle.stop.store(true, Ordering::Release);
    }
}

/// Read appended complete lines starting at `*offset`, advancing `*offset` past
/// the last newline consumed. Returns the appended text (one or more whole
/// lines) or an empty string when there's nothing new. Handles truncation
/// (file replaced / rotated) by resetting to the start.
fn read_appended(path: &Path, offset: &mut u64) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    if len < *offset {
        *offset = 0;
    }
    if len == *offset {
        return Ok(String::new());
    }
    file.seek(SeekFrom::Start(*offset))?;
    let mut buf = Vec::with_capacity((len - *offset) as usize);
    file.read_to_end(&mut buf)?;
    let last_nl = match buf.iter().rposition(|&b| b == b'\n') {
        Some(i) => i,
        None => return Ok(String::new()), // no complete line yet
    };
    *offset += (last_nl + 1) as u64;
    Ok(String::from_utf8_lossy(&buf[..=last_nl]).into_owned())
}

/// Subscribe to a transcript file. Emits the full existing content first (so the
/// GUI shows history), then streams appended lines as the live `claude` writes
/// them. Idempotent per path: re-subscribing replaces the previous tail.
#[tauri::command]
pub fn claude_transcript_subscribe(
    state: tauri::State<'_, ClaudeState>,
    path: String,
    on_chunk: Channel<String>,
) -> Result<(), String> {
    let canon = validate_transcript_path(&path)?;
    let key = canon.to_string_lossy().into_owned();

    // Replace any existing tail for this path.
    stop_tail(&state, &key);

    let mut offset: u64 = 0;
    // Initial backfill: everything already written.
    match read_appended(&canon, &mut offset) {
        Ok(initial) if !initial.is_empty() => {
            let _ = on_chunk.send(initial);
        }
        Ok(_) => {}
        Err(e) => return Err(format!("read transcript: {e}")),
    }

    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                if matches!(ev.kind, EventKind::Access(_)) {
                    return;
                }
                let _ = tx.send(());
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;
    // Watch the parent dir: editors/rotations replace the inode, which a
    // file-level watch would miss.
    let parent = canon.parent().ok_or("transcript has no parent dir")?;
    watcher
        .watch(parent, RecursiveMode::NonRecursive)
        .map_err(|e| format!("watch {}: {e}", parent.display()))?;

    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let path_thread = canon.clone();
    std::thread::Builder::new()
        .name("terax-claude-tail".into())
        .spawn(move || {
            let mut offset = offset;
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(()) => {
                        // Drain the debounce window so a burst is one read.
                        let deadline = Instant::now() + DEBOUNCE;
                        while rx.recv_timeout(DEBOUNCE.min(
                            deadline.saturating_duration_since(Instant::now()),
                        )).is_ok()
                        {
                            if Instant::now() >= deadline {
                                break;
                            }
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        if stop_thread.load(Ordering::Acquire) {
                            return;
                        }
                        continue;
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                if stop_thread.load(Ordering::Acquire) {
                    return;
                }
                match read_appended(&path_thread, &mut offset) {
                    Ok(chunk) if !chunk.is_empty() => {
                        if on_chunk.send(chunk).is_err() {
                            return; // channel closed (frontend gone)
                        }
                    }
                    Ok(_) => {}
                    Err(e) => log::debug!("claude tail read failed: {e}"),
                }
            }
        })
        .map_err(|e| e.to_string())?;

    state
        .tails
        .lock()
        .unwrap()
        .insert(key, TailHandle { stop, _watcher: watcher });
    Ok(())
}

#[tauri::command]
pub fn claude_transcript_unsubscribe(
    state: tauri::State<'_, ClaudeState>,
    path: String,
) -> Result<(), String> {
    // Accept either the raw or canonical form.
    let key = std::fs::canonicalize(&path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(path);
    stop_tail(&state, &key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn encodes_project_dir_like_claude() {
        assert_eq!(encode_project_dir("/home/user/git/terax-ai"), "-home-user-git-terax-ai");
        assert_eq!(
            encode_project_dir("/home/user/.claude/mem/observer/sessions"),
            "-home-user--claude-mem-observer-sessions"
        );
        assert_eq!(encode_project_dir("/a_b/c.d"), "-a-b-c-d");
    }

    #[test]
    fn read_appended_emits_only_complete_lines() {
        let dir = std::env::temp_dir().join(format!("terax-claude-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        let mut f = File::create(&path).unwrap();
        write!(f, "{{\"a\":1}}\n{{\"b\":2}}\n{{\"part").unwrap();
        f.flush().unwrap();

        let mut offset = 0u64;
        let out = read_appended(&path, &mut offset).unwrap();
        assert_eq!(out, "{\"a\":1}\n{\"b\":2}\n");

        // Partial trailing line is not consumed; completing it emits it next.
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(f, "ial\":3}}").unwrap();
        f.flush().unwrap();
        let out2 = read_appended(&path, &mut offset).unwrap();
        assert_eq!(out2, "{\"partial\":3}\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_appended_resets_on_truncation() {
        let dir = std::env::temp_dir().join(format!("terax-claude-trunc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        std::fs::write(&path, "{\"a\":1}\n{\"b\":2}\n").unwrap();
        let mut offset = 0u64;
        let _ = read_appended(&path, &mut offset).unwrap();
        assert!(offset > 0);

        std::fs::write(&path, "{\"c\":3}\n").unwrap();
        let out = read_appended(&path, &mut offset).unwrap();
        assert_eq!(out, "{\"c\":3}\n");

        std::fs::remove_dir_all(&dir).ok();
    }
}
