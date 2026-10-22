//! Crash-safe recovery of unsaved buffers.
//!
//! Each editable tab with unsaved changes periodically writes a snapshot — its path and
//! full text — to the app-data recovery directory, keyed by a per-tab id. Saving or
//! closing the tab removes its snapshot. On startup any leftover snapshots (from a crash,
//! or from quitting with unsaved work) are offered back to the user.
//!
//! This is a side journal: it never touches the user's own file, so "save" keeps its
//! explicit meaning. The snapshot holds the whole document text; cheap copy-on-write
//! snapshots (near-free on a persistent buffer) are a later optimisation — for now a
//! debounced full-text write is plenty for the editable (in-RAM) engine.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// The full recovery payload for one unsaved buffer.
#[derive(Serialize, Deserialize, Clone)]
pub struct RecoverySnapshot {
    pub id: String,
    pub path: Option<String>,
    pub text: String,
    pub saved_at: u64,
}

/// A lightweight listing entry (no text), for the startup recovery prompt.
#[derive(Serialize, Clone)]
pub struct RecoveryMeta {
    pub id: String,
    pub path: Option<String>,
    pub name: String,
    pub char_count: usize,
    pub saved_at: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `<app_data>/recovery`, created if missing.
pub fn recovery_dir(base: &Path) -> std::io::Result<PathBuf> {
    let dir = base.join("recovery");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Write (atomically) the snapshot for `id`: a temp file flushed then renamed over the
/// target, so a crash mid-write can't corrupt an existing snapshot.
pub fn write(dir: &Path, id: &str, path: Option<&str>, text: &str) -> std::io::Result<()> {
    let snap = RecoverySnapshot {
        id: id.to_string(),
        path: path.map(str::to_string),
        text: text.to_string(),
        saved_at: now_secs(),
    };
    let json = serde_json::to_string(&snap)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let target = dir.join(format!("{id}.json"));
    let tmp = dir.join(format!(".{id}.tmp"));
    fs::write(&tmp, json.as_bytes())?;
    fs::rename(&tmp, &target)
}

/// Remove the snapshot for `id` (best effort — a missing file is not an error).
pub fn remove(dir: &Path, id: &str) {
    let _ = fs::remove_file(dir.join(format!("{id}.json")));
}

/// List all snapshots (newest first), without loading their text.
pub fn list(dir: &Path) -> Vec<RecoveryMeta> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&p) else {
            continue;
        };
        let Ok(snap) = serde_json::from_str::<RecoverySnapshot>(&raw) else {
            continue;
        };
        let name = snap
            .path
            .as_deref()
            .and_then(|p| Path::new(p).file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("untitled")
            .to_string();
        out.push(RecoveryMeta {
            id: snap.id,
            path: snap.path,
            name,
            char_count: snap.text.chars().count(),
            saved_at: snap.saved_at,
        });
    }
    out.sort_by_key(|m| std::cmp::Reverse(m.saved_at));
    out
}

/// Read one snapshot in full (for restoring it).
pub fn read(dir: &Path, id: &str) -> std::io::Result<RecoverySnapshot> {
    let raw = fs::read_to_string(dir.join(format!("{id}.json")))?;
    serde_json::from_str(&raw).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        // Unique per call: tests run in parallel in one process, so a pid+seconds name
        // would collide. A monotonic counter keeps each test's directory its own.
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let d = std::env::temp_dir().join(format!(
            "tuhi-recovery-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&d);
        recovery_dir(&d).unwrap()
    }

    #[test]
    fn write_list_read_remove_round_trip() {
        let dir = tmp();
        write(&dir, "abc", Some("C:/notes/todo.md"), "hello\nworld").unwrap();
        let listed = list(&dir);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "abc");
        assert_eq!(listed[0].name, "todo.md");
        assert_eq!(listed[0].char_count, 11);

        let snap = read(&dir, "abc").unwrap();
        assert_eq!(snap.text, "hello\nworld");
        assert_eq!(snap.path.as_deref(), Some("C:/notes/todo.md"));

        remove(&dir, "abc");
        assert!(list(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_is_newest_first_and_skips_junk() {
        let dir = tmp();
        write(&dir, "one", Some("a.md"), "x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100)); // saved_at is seconds
        write(&dir, "two", Some("b.md"), "y").unwrap();
        fs::write(dir.join("notjson.txt"), b"ignore me").unwrap();
        let listed = list(&dir);
        assert_eq!(listed.len(), 2, "the non-json file is ignored");
        assert_eq!(listed[0].id, "two", "newest first");
        let _ = fs::remove_dir_all(&dir);
    }
}
