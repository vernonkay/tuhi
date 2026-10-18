//! Editing core (Option B — see docs/decisions/0002).
//!
//! The text buffer lives here in Rust, backed by a `ropey` rope so that very
//! large files are cheap to open and edit. The web-view UI never receives the
//! whole document — it asks for a *viewport* (the visible lines) and sends
//! edits back. The protocol is intentionally simple and synchronous: we took
//! the rope from Xi-editor's lineage and deliberately left the async/CRDT
//! complexity that sank it (see the ADR).

use ropey::Rope;
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// A single open document. For now the editor holds exactly one; tabs (a
/// registry of documents keyed by id) are the next step, kept out until the
/// single-document path is proven — Xi's lesson: resist premature generality.
pub struct Document {
    rope: Rope,
    path: Option<PathBuf>,
    dirty: bool,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            rope: Rope::new(),
            path: None,
            dirty: false,
        }
    }
}

/// Tauri-managed state wrapping the current document behind a mutex.
#[derive(Default)]
pub struct EditorState(pub Mutex<Document>);

/// Lightweight document summary returned to the UI (never the whole text).
#[derive(Serialize)]
pub struct DocumentMeta {
    pub path: Option<String>,
    pub line_count: usize,
    pub char_count: usize,
    pub dirty: bool,
}

fn meta(doc: &Document) -> DocumentMeta {
    DocumentMeta {
        path: doc.path.as_ref().map(|p| p.display().to_string()),
        line_count: doc.rope.len_lines(),
        char_count: doc.rope.len_chars(),
        dirty: doc.dirty,
    }
}

/// Open a file from disk into the rope. Streams via a buffered reader so the
/// whole file is not first loaded into a `String`.
#[tauri::command]
pub fn open_document(path: String, state: State<EditorState>) -> Result<DocumentMeta, String> {
    let file = File::open(&path).map_err(|e| e.to_string())?;
    let rope = Rope::from_reader(BufReader::new(file)).map_err(|e| e.to_string())?;
    let mut doc = state.0.lock().map_err(|e| e.to_string())?;
    *doc = Document {
        rope,
        path: Some(PathBuf::from(&path)),
        dirty: false,
    };
    Ok(meta(&doc))
}

/// Return the lines `[start, start + count)` — the UI's visible window.
#[tauri::command]
pub fn get_viewport(
    start: usize,
    count: usize,
    state: State<EditorState>,
) -> Result<Vec<String>, String> {
    let doc = state.0.lock().map_err(|e| e.to_string())?;
    let total = doc.rope.len_lines();
    let end = start.saturating_add(count).min(total);
    let lines = (start..end).map(|i| doc.rope.line(i).to_string()).collect();
    Ok(lines)
}

/// Insert `text` at a character index.
#[tauri::command]
pub fn insert_text(
    char_idx: usize,
    text: String,
    state: State<EditorState>,
) -> Result<DocumentMeta, String> {
    let mut doc = state.0.lock().map_err(|e| e.to_string())?;
    if char_idx > doc.rope.len_chars() {
        return Err("insert index out of range".into());
    }
    doc.rope.insert(char_idx, &text);
    doc.dirty = true;
    Ok(meta(&doc))
}

/// Delete the character range `[start, end)`.
#[tauri::command]
pub fn delete_range(
    start: usize,
    end: usize,
    state: State<EditorState>,
) -> Result<DocumentMeta, String> {
    let mut doc = state.0.lock().map_err(|e| e.to_string())?;
    if start > end || end > doc.rope.len_chars() {
        return Err("delete range out of bounds".into());
    }
    doc.rope.remove(start..end);
    doc.dirty = true;
    Ok(meta(&doc))
}

/// Save to `path` (or the document's existing path if `None`).
#[tauri::command]
pub fn save_document(
    path: Option<String>,
    state: State<EditorState>,
) -> Result<DocumentMeta, String> {
    let mut doc = state.0.lock().map_err(|e| e.to_string())?;
    let target = match path.or_else(|| doc.path.as_ref().map(|p| p.display().to_string())) {
        Some(t) => t,
        None => return Err("no path to save to".into()),
    };
    let file = File::create(&target).map_err(|e| e.to_string())?;
    doc.rope
        .write_to(BufWriter::new(file))
        .map_err(|e| e.to_string())?;
    doc.path = Some(PathBuf::from(&target));
    doc.dirty = false;
    Ok(meta(&doc))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewport_returns_requested_lines() {
        let mut d = Document::default();
        d.rope = Rope::from_str("one\ntwo\nthree\n");
        let total = d.rope.len_lines();
        let start = 1;
        let end = (start + 1).min(total);
        let lines: Vec<String> = (start..end).map(|i| d.rope.line(i).to_string()).collect();
        assert_eq!(lines, vec!["two\n".to_string()]);
    }

    #[test]
    fn edits_change_length_and_content() {
        let mut d = Document::default();
        d.rope.insert(0, "abc");
        assert_eq!(d.rope.len_chars(), 3);
        d.rope.remove(0..1);
        assert_eq!(d.rope.to_string(), "bc");
    }
}
