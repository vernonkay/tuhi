//! Editing core.
//!
//! ADR-0002: the editable text lives in Rust; the web-view renders only a
//! viewport (the visible lines) and sends edits back. The protocol is
//! deliberately simple and synchronous — we took the rope idea from Xi-editor's
//! lineage and left the async/CRDT complexity that sank it.
//!
//! ADR-0003: the buffer sits behind the [`Buffer`] trait so the engine is
//! swappable. [`RopeBuffer`] is the in-memory `ropey` implementation — simple and
//! proven, but with resident memory ≈ file size, so it is the *fallback*. The
//! forthcoming `PieceTreeBuffer` (a piece tree over a memory-mapped original) will
//! implement the same trait for true beyond-RAM large files. The Tauri commands
//! depend on the trait, never a concrete buffer, so swapping the engine — or
//! reverting to this one — is a single line in [`EditorState::default`].

use ropey::Rope;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

mod encoding;
mod error;
mod highlight;
mod mmapbuf;
mod search;
use encoding::Encoding;
use error::EditorError;
use highlight::{HIGHLIGHT_MAX_BYTES, Span};
use search::build_regex;

/// Lightweight document summary returned to the UI (never the whole text).
#[derive(Serialize)]
pub struct DocumentMeta {
    pub path: Option<String>,
    pub line_count: usize,
    pub char_count: usize,
    pub dirty: bool,
    /// True when the document is open on the read-only large-file (mmap) engine.
    pub readonly: bool,
}

/// A caret position as (line, column), both zero-based, the column counted in
/// Unicode characters within the line. The UI manages the caret itself in this
/// character space, so there is no UTF-16/DOM-offset mismatch to reconcile.
#[derive(Serialize)]
pub struct CaretPos {
    pub line: usize,
    pub col: usize,
}

/// One line as sent to the UI. `text` is capped at `MAX_VIEWPORT_LINE` characters
/// so a pathological line (a multi-MB minified file with no newlines) cannot
/// serialise megabytes across IPC or spawn a giant DOM node. `chars` is always the
/// line's TRUE character count (including a trailing newline) so the UI's offset
/// accounting stays correct even when `text` is truncated.
#[derive(Serialize)]
pub struct ViewportLine {
    pub text: String,
    pub chars: usize,
    pub truncated: bool,
    pub spans: Vec<Span>,
}

const MAX_VIEWPORT_LINE: usize = 10_000;

/// One entry in a directory listing for the file-tree panel.
#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// One heading or symbol in the document outline panel.
#[derive(Serialize)]
pub struct OutlineItem {
    pub level: u8,
    pub title: String,
    pub line: usize,
}

/// Cap on filter results, so even a huge log returns a bounded payload.
const MAX_FILTER_MATCHES: usize = 1000;

/// One matching line from a live filter: its 0-based line index and (capped) text.
#[derive(Serialize)]
pub struct FilterMatch {
    pub line: usize,
    pub text: String,
    pub truncated: bool,
}

/// The editing buffer behind the Tauri commands.
///
/// Addressing is by Unicode character index for now; the move to viewport-local
/// offsets and a `(line, col)` mapping (so UTF-16 carets from the web-view map
/// correctly) is tracked separately, as is a line-length cap on `viewport`.
pub trait Buffer: Send {
    /// Load a file from disk, replacing the current document.
    fn open(&mut self, path: &str) -> Result<DocumentMeta, EditorError>;
    /// Return the lines `[start, start + count)` — the UI's visible window.
    fn viewport(&self, start: usize, count: usize) -> Result<Vec<ViewportLine>, EditorError>;
    /// Insert `text` at a character index.
    fn insert(&mut self, char_idx: usize, text: &str) -> Result<DocumentMeta, EditorError>;
    /// Delete the character range `[start, end)`.
    fn delete(&mut self, start: usize, end: usize) -> Result<DocumentMeta, EditorError>;
    /// Save to `path` (or the document's existing path if `None`).
    fn save(&mut self, path: Option<String>) -> Result<DocumentMeta, EditorError>;
    /// Global character index for a (line, col) caret, clamped to the line's end
    /// (never past its line break) and to the document.
    fn pos_to_char(&self, line: usize, col: usize) -> usize;
    /// The (line, col) a global character index falls on, clamped to the document.
    fn char_to_pos(&self, char_idx: usize) -> CaretPos;
    /// The text in the character range `[start, end)` (for copy/cut).
    fn read_range(&self, start: usize, end: usize) -> Result<String, EditorError>;
    /// Find all matches; returns character ranges `[start, end)`.
    fn search(
        &self,
        query: &str,
        use_regex: bool,
        case_sensitive: bool,
    ) -> Result<Vec<[usize; 2]>, EditorError>;
    /// Replace every match; returns the new document meta and the number replaced.
    fn replace_all(
        &mut self,
        query: &str,
        use_regex: bool,
        case_sensitive: bool,
        replacement: &str,
    ) -> Result<(DocumentMeta, usize), EditorError>;
    /// Current document summary.
    fn meta(&self) -> DocumentMeta;
    /// Recompute cached syntax highlighting (no-op where the engine doesn't highlight).
    fn rehighlight(&mut self);
    /// Switch the highlight theme (dark vs light) and re-highlight in place. No-op
    /// where the engine doesn't highlight (e.g. the large-file mmap buffer).
    fn set_dark(&mut self, _dark: bool) {}
    /// Document outline (markdown headings, or simple code symbols); empty where
    /// the engine doesn't support it.
    fn outline(&self) -> Vec<OutlineItem> {
        Vec::new()
    }
    /// Undo the last edit; return the caret char-index to move to, or `None` if
    /// there is nothing to undo (or the engine has no undo, e.g. the mmap engine).
    fn undo(&mut self) -> Result<Option<usize>, EditorError> {
        Ok(None)
    }
    /// Redo the last undone edit; see [`Buffer::undo`].
    fn redo(&mut self) -> Result<Option<usize>, EditorError> {
        Ok(None)
    }
    /// The whole document as a string (empty where the engine can't, e.g. mmap).
    fn text(&self) -> String {
        String::new()
    }
    /// Replace the whole document in one undoable step (read-only engines refuse).
    fn replace_document(&mut self, _text: &str) -> Result<DocumentMeta, EditorError> {
        Err(EditorError::ReadOnly)
    }
    /// Lines matching `query` (as a regex), for the non-destructive filter view.
    /// Capped at [`MAX_FILTER_MATCHES`]. Default: no matches.
    fn filter(
        &self,
        _query: &str,
        _use_regex: bool,
        _case_sensitive: bool,
    ) -> Result<Vec<FilterMatch>, EditorError> {
        Ok(Vec::new())
    }
}

/// One open document (a tab).
struct Tab {
    id: u32,
    path: Option<String>,
    buffer: Box<dyn Buffer>,
}

/// Summary of one tab for the UI's tab strip.
#[derive(Serialize)]
pub struct TabSummary {
    pub id: u32,
    pub name: String,
    /// The file's path, if saved (used to reopen the session on next launch).
    pub path: Option<String>,
    pub dirty: bool,
    pub readonly: bool,
    pub active: bool,
}

/// The tab strip plus the active document's meta, returned by the tab commands.
#[derive(Serialize)]
pub struct TabsState {
    pub tabs: Vec<TabSummary>,
    pub active: Option<u32>,
    pub meta: Option<DocumentMeta>,
}

/// The open documents, keyed by id, with one active. Each tab holds its own
/// buffer (so a big read-only mmap tab and small editable tabs coexist).
#[derive(Default)]
pub struct Registry {
    tabs: Vec<Tab>,
    active: Option<u32>,
    next_id: u32,
}

impl Registry {
    fn active_buffer(&self) -> Result<&(dyn Buffer + 'static), EditorError> {
        let id = self.active.ok_or(EditorError::NoActiveDocument)?;
        self.tabs
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.buffer.as_ref())
            .ok_or(EditorError::ActiveTabMissing)
    }

    fn active_buffer_mut(&mut self) -> Result<&mut (dyn Buffer + 'static), EditorError> {
        let id = self.active.ok_or(EditorError::NoActiveDocument)?;
        self.tabs
            .iter_mut()
            .find(|t| t.id == id)
            .map(|t| t.buffer.as_mut())
            .ok_or(EditorError::ActiveTabMissing)
    }

    fn summaries(&self) -> Vec<TabSummary> {
        self.tabs
            .iter()
            .map(|t| {
                let m = t.buffer.meta();
                let name = t
                    .path
                    .as_deref()
                    .and_then(|p| std::path::Path::new(p).file_name())
                    .and_then(|n| n.to_str())
                    .unwrap_or("untitled")
                    .to_string();
                TabSummary {
                    id: t.id,
                    name,
                    path: t.path.clone(),
                    dirty: m.dirty,
                    readonly: m.readonly,
                    active: Some(t.id) == self.active,
                }
            })
            .collect()
    }

    fn tabs_state(&self) -> TabsState {
        TabsState {
            tabs: self.summaries(),
            active: self.active,
            meta: self.active_buffer().ok().map(|b| b.meta()),
        }
    }
}

/// Tauri-managed state: the open documents.
pub struct EditorState(pub Mutex<Registry>);

impl Default for EditorState {
    fn default() -> Self {
        Self(Mutex::new(Registry::default()))
    }
}

/// Cap on undo-history entries; the oldest are dropped past this (bounds memory).
const MAX_UNDO: usize = 2000;

/// One reversible change: at character index `at`, `removed` was replaced by
/// `inserted`. Redo deletes `removed` then inserts `inserted`; undo does the
/// reverse. A plain insert has an empty `removed`; a plain delete an empty `inserted`.
#[derive(Debug, Clone)]
struct Change {
    at: usize,
    removed: String,
    inserted: String,
}

/// `ropey`-backed buffer: the whole document lives in memory in a rope.
///
/// Edits and large-but-RAM-sized files are cheap (O(log n)); its ceiling is that
/// resident memory tracks file size (a 5 GB file needs ~5 GB of RAM — see the
/// probe in ADR-0003), which is why it is the fallback, not the large-file engine.
pub struct RopeBuffer {
    rope: Rope,
    path: Option<PathBuf>,
    dirty: bool,
    ext: String,
    highlights: Vec<Vec<Span>>,
    dark: bool,
    /// The file's detected encoding and BOM, remembered so save round-trips them
    /// rather than silently rewriting a non-UTF-8 file as UTF-8.
    encoding: Encoding,
    bom: bool,
    /// Undo/redo history of reversible changes (newest on top of each stack).
    undo_stack: Vec<Change>,
    redo_stack: Vec<Change>,
}

impl Default for RopeBuffer {
    fn default() -> Self {
        Self {
            rope: Rope::new(),
            path: None,
            dirty: false,
            ext: String::new(),
            highlights: Vec::new(),
            dark: false,
            encoding: Encoding::Utf8,
            bom: false,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }
}

impl RopeBuffer {
    fn make_meta(&self) -> DocumentMeta {
        DocumentMeta {
            path: self.path.as_ref().map(|p| p.display().to_string()),
            line_count: self.rope.len_lines(),
            char_count: self.rope.len_chars(),
            dirty: self.dirty,
            readonly: false,
        }
    }

    /// Push a change onto the undo stack, dropping the oldest past the cap.
    fn push_undo(&mut self, change: Change) {
        self.undo_stack.push(change);
        if self.undo_stack.len() > MAX_UNDO {
            self.undo_stack.remove(0);
        }
    }
}

impl Buffer for RopeBuffer {
    fn open(&mut self, path: &str) -> Result<DocumentMeta, EditorError> {
        // Read the whole file (O(file-size) resident memory — ropey holds the whole
        // document; ADR-0003's mmap engine covers large files) and decode by detected
        // encoding, so non-UTF-8 files (many logs) open instead of hard-failing.
        let bytes = std::fs::read(path)?;
        let decoded = encoding::decode(&bytes);
        self.rope = Rope::from_str(&decoded.text);
        self.encoding = decoded.encoding;
        self.bom = decoded.bom;
        self.path = Some(PathBuf::from(path));
        self.dirty = false;
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_string();
        self.rehighlight();
        Ok(self.make_meta())
    }

    fn viewport(&self, start: usize, count: usize) -> Result<Vec<ViewportLine>, EditorError> {
        let total = self.rope.len_lines();
        let end = start.saturating_add(count).min(total);
        let lines = (start..end)
            .map(|i| {
                let slice = self.rope.line(i);
                let chars = slice.len_chars();
                let spans = self.highlights.get(i).cloned().unwrap_or_default();
                if chars > MAX_VIEWPORT_LINE {
                    ViewportLine {
                        text: slice.slice(0..MAX_VIEWPORT_LINE).to_string(),
                        chars,
                        truncated: true,
                        spans,
                    }
                } else {
                    ViewportLine {
                        text: slice.to_string(),
                        chars,
                        truncated: false,
                        spans,
                    }
                }
            })
            .collect();
        Ok(lines)
    }

    fn insert(&mut self, char_idx: usize, text: &str) -> Result<DocumentMeta, EditorError> {
        if char_idx > self.rope.len_chars() {
            return Err(EditorError::IndexOutOfRange {
                idx: char_idx,
                len: self.rope.len_chars(),
            });
        }
        if text.is_empty() {
            return Ok(self.make_meta());
        }
        self.rope.insert(char_idx, text);
        self.dirty = true;
        self.redo_stack.clear();
        // Coalesce contiguous typing into one undo step: extend the last change when
        // it is a pure insert, the new text continues immediately after it, and
        // neither crosses a newline. A caret move makes `char_idx` non-contiguous,
        // which ends the run naturally.
        let coalesced = match self.undo_stack.last_mut() {
            Some(last)
                if last.removed.is_empty()
                    && !text.contains('\n')
                    && !last.inserted.ends_with('\n')
                    && char_idx == last.at + last.inserted.chars().count() =>
            {
                last.inserted.push_str(text);
                true
            }
            _ => false,
        };
        if !coalesced {
            self.push_undo(Change {
                at: char_idx,
                removed: String::new(),
                inserted: text.to_string(),
            });
        }
        Ok(self.make_meta())
    }

    fn delete(&mut self, start: usize, end: usize) -> Result<DocumentMeta, EditorError> {
        if start > end || end > self.rope.len_chars() {
            return Err(EditorError::InvalidRange { start, end });
        }
        if start == end {
            return Ok(self.make_meta());
        }
        let removed = self.rope.slice(start..end).to_string();
        self.rope.remove(start..end);
        self.dirty = true;
        self.redo_stack.clear();
        self.push_undo(Change {
            at: start,
            removed,
            inserted: String::new(),
        });
        Ok(self.make_meta())
    }

    fn save(&mut self, path: Option<String>) -> Result<DocumentMeta, EditorError> {
        let target = match path.or_else(|| self.path.as_ref().map(|p| p.display().to_string())) {
            Some(t) => t,
            None => return Err(EditorError::NoPath),
        };
        let target_path = PathBuf::from(&target);

        // Atomic save: write a sibling temp file, flush it to disk, then rename over
        // the target. A write error or crash leaves the original untouched — rename
        // is atomic on the same filesystem, and std::fs::rename replaces the
        // destination on Windows too. (The old path truncated the original up-front.)
        let dir = match target_path.parent() {
            Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
            _ => PathBuf::from("."),
        };
        let file_name = target_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("tuhi");
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let tmp_path = dir.join(format!(
            ".{file_name}.tuhi-tmp-{}-{nanos}",
            std::process::id()
        ));

        // Write the rope to the temp file and fsync before the rename, re-encoding to
        // the file's original encoding/BOM. Plain UTF-8 (the common case) streams
        // straight from the rope; other encodings go through a one-shot encode.
        let write = || -> io::Result<()> {
            let mut w = BufWriter::new(File::create(&tmp_path)?);
            if self.encoding == Encoding::Utf8 && !self.bom {
                self.rope.write_to(&mut w)?;
            } else {
                let bytes = encoding::encode(&self.rope.to_string(), self.encoding, self.bom);
                w.write_all(&bytes)?;
            }
            w.flush()?;
            w.into_inner()
                .map_err(io::IntoInnerError::into_error)?
                .sync_all()
        };
        if let Err(e) = write() {
            let _ = fs::remove_file(&tmp_path);
            return Err(EditorError::Other(format!(
                "save failed, original left intact: {e}"
            )));
        }

        // Carry the existing file's permissions across the replace (best effort).
        if let Ok(meta) = fs::metadata(&target_path) {
            let _ = fs::set_permissions(&tmp_path, meta.permissions());
        }

        if let Err(e) = fs::rename(&tmp_path, &target_path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(EditorError::Other(format!(
                "save failed on rename, original left intact: {e}"
            )));
        }

        self.path = Some(target_path);
        self.dirty = false;
        Ok(self.make_meta())
    }

    fn pos_to_char(&self, line: usize, col: usize) -> usize {
        let total = self.rope.len_lines();
        if total == 0 {
            return 0;
        }
        let line = line.min(total - 1);
        let line_start = self.rope.line_to_char(line);
        let slice = self.rope.line(line);
        // The caret may not sit past the line break: cap the column at the line's
        // char length excluding a trailing "\n" (and a preceding "\r" for CRLF).
        let mut max_col = slice.len_chars();
        if max_col > 0 && slice.char(max_col - 1) == '\n' {
            max_col -= 1;
            if max_col > 0 && slice.char(max_col - 1) == '\r' {
                max_col -= 1;
            }
        }
        line_start + col.min(max_col)
    }

    fn char_to_pos(&self, char_idx: usize) -> CaretPos {
        let idx = char_idx.min(self.rope.len_chars());
        let line = self.rope.char_to_line(idx);
        CaretPos {
            line,
            col: idx - self.rope.line_to_char(line),
        }
    }

    fn read_range(&self, start: usize, end: usize) -> Result<String, EditorError> {
        if start > end || end > self.rope.len_chars() {
            return Err(EditorError::InvalidRange { start, end });
        }
        Ok(self.rope.slice(start..end).to_string())
    }

    fn search(
        &self,
        query: &str,
        use_regex: bool,
        case_sensitive: bool,
    ) -> Result<Vec<[usize; 2]>, EditorError> {
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let re = build_regex(query, use_regex, case_sensitive).map_err(EditorError::Regex)?;
        let text = self.rope.to_string();
        let mut out = Vec::new();
        for m in re.find_iter(&text) {
            if m.start() == m.end() {
                continue; // skip empty matches (e.g. a lone `.*`)
            }
            out.push([
                self.rope.byte_to_char(m.start()),
                self.rope.byte_to_char(m.end()),
            ]);
            if out.len() >= 10_000 {
                break; // cap the payload
            }
        }
        Ok(out)
    }

    fn replace_all(
        &mut self,
        query: &str,
        use_regex: bool,
        case_sensitive: bool,
        replacement: &str,
    ) -> Result<(DocumentMeta, usize), EditorError> {
        if query.is_empty() {
            return Ok((self.make_meta(), 0));
        }
        let re = build_regex(query, use_regex, case_sensitive).map_err(EditorError::Regex)?;
        let text = self.rope.to_string();
        let count = re.find_iter(&text).filter(|m| m.start() != m.end()).count();
        if count > 0 {
            // In regex mode `$1` etc. expand; in literal mode they do not.
            let new = if use_regex {
                re.replace_all(&text, replacement).into_owned()
            } else {
                re.replace_all(&text, regex::NoExpand(replacement))
                    .into_owned()
            };
            self.redo_stack.clear();
            // One undo step for the whole replace-all (stores the before/after text).
            self.push_undo(Change {
                at: 0,
                removed: text,
                inserted: new.clone(),
            });
            self.rope = Rope::from_str(&new);
            self.dirty = true;
            self.rehighlight();
        }
        Ok((self.make_meta(), count))
    }

    fn meta(&self) -> DocumentMeta {
        self.make_meta()
    }

    /// Recompute cached highlight spans for the whole document, when it is small
    /// enough and has a known file type; otherwise leave it plain. Called on open,
    /// after replace-all, and (debounced from the UI) after edits settle.
    fn rehighlight(&mut self) {
        if self.rope.len_bytes() <= HIGHLIGHT_MAX_BYTES && !self.ext.is_empty() {
            let text = self.rope.to_string();
            self.highlights =
                highlight::highlight_doc(&text, &self.ext, self.dark).unwrap_or_default();
        } else {
            self.highlights = Vec::new();
        }
    }

    fn set_dark(&mut self, dark: bool) {
        self.dark = dark;
        self.rehighlight();
    }

    fn outline(&self) -> Vec<OutlineItem> {
        let is_md = matches!(
            self.ext.as_str(),
            "md" | "markdown" | "mdown" | "mkd" | "markdn"
        );
        const CODE_STARTS: [&str; 15] = [
            "pub fn ",
            "fn ",
            "pub struct ",
            "struct ",
            "pub enum ",
            "enum ",
            "impl ",
            "pub trait ",
            "trait ",
            "pub mod ",
            "mod ",
            "class ",
            "function ",
            "def ",
            "export ",
        ];
        let mut out = Vec::new();
        for i in 0..self.rope.len_lines() {
            if out.len() >= 5000 {
                break;
            }
            let line = self.rope.line(i);
            let n = line.len_chars().min(200);
            let raw: String = line.slice(0..n).to_string();
            let t = raw.trim_start();
            if is_md {
                // ATX headings: 1-6 '#' then a space. '#' is ASCII, so the byte index
                // after the hashes equals their count.
                let hashes = t.chars().take_while(|c| *c == '#').count();
                if (1..=6).contains(&hashes) && t.chars().nth(hashes) == Some(' ') {
                    let title = t[hashes..].trim().trim_end_matches('#').trim().to_string();
                    if !title.is_empty() {
                        out.push(OutlineItem {
                            level: hashes as u8,
                            title,
                            line: i,
                        });
                    }
                }
            } else if CODE_STARTS.iter().any(|p| t.starts_with(p)) {
                let title: String = t
                    .trim_end()
                    .trim_end_matches('{')
                    .trim()
                    .chars()
                    .take(80)
                    .collect();
                if !title.is_empty() {
                    // Nest by indentation (tab = 4 cols), so e.g. methods sit under their
                    // impl/mod. One indent step per ~4 columns, capped at 6 levels.
                    let indent: usize = raw
                        .chars()
                        .take_while(|c| c.is_whitespace())
                        .map(|c| if c == '\t' { 4 } else { 1 })
                        .sum();
                    let level = (1 + indent / 4).min(6) as u8;
                    out.push(OutlineItem {
                        level,
                        title,
                        line: i,
                    });
                }
            }
        }
        out
    }

    fn undo(&mut self) -> Result<Option<usize>, EditorError> {
        let Some(change) = self.undo_stack.pop() else {
            return Ok(None);
        };
        // Reverse the change: remove what it inserted, restore what it removed.
        let ins_len = change.inserted.chars().count();
        self.rope.remove(change.at..change.at + ins_len);
        self.rope.insert(change.at, &change.removed);
        let caret = change.at + change.removed.chars().count();
        self.redo_stack.push(change);
        self.dirty = true;
        self.rehighlight();
        Ok(Some(caret))
    }

    fn redo(&mut self) -> Result<Option<usize>, EditorError> {
        let Some(change) = self.redo_stack.pop() else {
            return Ok(None);
        };
        // Re-apply: remove what it removed, insert what it inserted.
        let rem_len = change.removed.chars().count();
        self.rope.remove(change.at..change.at + rem_len);
        self.rope.insert(change.at, &change.inserted);
        let caret = change.at + change.inserted.chars().count();
        self.undo_stack.push(change);
        self.dirty = true;
        self.rehighlight();
        Ok(Some(caret))
    }

    fn text(&self) -> String {
        self.rope.to_string()
    }

    fn replace_document(&mut self, text: &str) -> Result<DocumentMeta, EditorError> {
        let old = self.rope.to_string();
        if old == text {
            return Ok(self.make_meta());
        }
        self.redo_stack.clear();
        self.push_undo(Change {
            at: 0,
            removed: old,
            inserted: text.to_string(),
        });
        self.rope = Rope::from_str(text);
        self.dirty = true;
        self.rehighlight();
        Ok(self.make_meta())
    }

    fn filter(
        &self,
        query: &str,
        use_regex: bool,
        case_sensitive: bool,
    ) -> Result<Vec<FilterMatch>, EditorError> {
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let re = build_regex(query, use_regex, case_sensitive).map_err(EditorError::Regex)?;
        let mut out = Vec::new();
        for i in 0..self.rope.len_lines() {
            let line = self.rope.line(i);
            let s = line.to_string();
            if re.is_match(&s) {
                let chars = line.len_chars();
                let truncated = chars > MAX_VIEWPORT_LINE;
                let text = if truncated {
                    line.slice(0..MAX_VIEWPORT_LINE).to_string()
                } else {
                    s
                };
                out.push(FilterMatch {
                    line: i,
                    text,
                    truncated,
                });
                if out.len() >= MAX_FILTER_MATCHES {
                    break;
                }
            }
        }
        Ok(out)
    }
}

// Tauri commands — thin delegations to the active buffer behind the mutex.

#[tauri::command]
pub fn open_document(
    path: String,
    dark: bool,
    state: State<EditorState>,
) -> Result<TabsState, EditorError> {
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let mut reg = state.0.lock().map_err(|_| EditorError::LockPoisoned)?;

    // If this file is already open, switch to its tab instead of duplicating it.
    let existing = reg
        .tabs
        .iter()
        .find(|t| t.path.as_deref() == Some(path.as_str()))
        .map(|t| t.id);
    if let Some(id) = existing {
        reg.active = Some(id);
        return Ok(reg.tabs_state());
    }

    // Pick the engine by file size: large files open read-only on the mmap engine
    // (instant, flat memory), smaller files on the editable `RopeBuffer`. `dark`
    // selects the highlight theme for the current colour scheme.
    let mut buffer: Box<dyn Buffer> = if size >= mmapbuf::MMAP_THRESHOLD_BYTES {
        Box::new(mmapbuf::MmapBuffer::default())
    } else {
        Box::new(RopeBuffer {
            dark,
            ..Default::default()
        })
    };
    buffer.open(&path)?;

    let id = reg.next_id;
    reg.next_id += 1;
    reg.tabs.push(Tab {
        id,
        path: Some(path),
        buffer,
    });
    reg.active = Some(id);
    Ok(reg.tabs_state())
}

#[tauri::command]
pub fn list_tabs(state: State<EditorState>) -> Result<TabsState, EditorError> {
    Ok(state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .tabs_state())
}

#[tauri::command]
pub fn switch_tab(id: u32, state: State<EditorState>) -> Result<TabsState, EditorError> {
    let mut reg = state.0.lock().map_err(|_| EditorError::LockPoisoned)?;
    if reg.tabs.iter().any(|t| t.id == id) {
        reg.active = Some(id);
        Ok(reg.tabs_state())
    } else {
        Err(EditorError::Other("no such tab".into()))
    }
}

#[tauri::command]
pub fn close_tab(id: u32, state: State<EditorState>) -> Result<TabsState, EditorError> {
    let mut reg = state.0.lock().map_err(|_| EditorError::LockPoisoned)?;
    if let Some(pos) = reg.tabs.iter().position(|t| t.id == id) {
        reg.tabs.remove(pos);
        if reg.active == Some(id) {
            let next = reg
                .tabs
                .get(pos)
                .or_else(|| reg.tabs.get(pos.saturating_sub(1)))
                .map(|t| t.id);
            reg.active = next;
        }
    }
    Ok(reg.tabs_state())
}

#[tauri::command]
pub fn get_viewport(
    start: usize,
    count: usize,
    state: State<EditorState>,
) -> Result<Vec<ViewportLine>, EditorError> {
    state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer()?
        .viewport(start, count)
}

#[tauri::command]
pub fn insert_text(
    char_idx: usize,
    text: String,
    state: State<EditorState>,
) -> Result<DocumentMeta, EditorError> {
    state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer_mut()?
        .insert(char_idx, &text)
}

#[tauri::command]
pub fn delete_range(
    start: usize,
    end: usize,
    state: State<EditorState>,
) -> Result<DocumentMeta, EditorError> {
    state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer_mut()?
        .delete(start, end)
}

#[tauri::command]
pub fn save_document(
    path: Option<String>,
    state: State<EditorState>,
) -> Result<DocumentMeta, EditorError> {
    state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer_mut()?
        .save(path)
}

/// Document meta after an undo/redo, plus where the caret should land (`None` when
/// there was nothing to undo/redo, so the UI leaves the caret where it is).
#[derive(Serialize)]
pub struct EditOutcome {
    pub meta: DocumentMeta,
    pub caret: Option<usize>,
}

#[tauri::command]
pub fn undo(state: State<EditorState>) -> Result<EditOutcome, EditorError> {
    let mut reg = state.0.lock().map_err(|_| EditorError::LockPoisoned)?;
    let b = reg.active_buffer_mut()?;
    let caret = b.undo()?;
    Ok(EditOutcome {
        meta: b.meta(),
        caret,
    })
}

#[tauri::command]
pub fn redo(state: State<EditorState>) -> Result<EditOutcome, EditorError> {
    let mut reg = state.0.lock().map_err(|_| EditorError::LockPoisoned)?;
    let b = reg.active_buffer_mut()?;
    let caret = b.redo()?;
    Ok(EditOutcome {
        meta: b.meta(),
        caret,
    })
}

/// Reformat the active document's JSON with indentation (pretty-print), in one
/// undoable step. Fails if it is not valid JSON or the buffer is read-only (a
/// large file on the mmap engine). Opening a minified blob never hangs, because the
/// viewport caps line length; this makes it readable.
#[tauri::command]
pub fn pretty_print(state: State<EditorState>) -> Result<DocumentMeta, EditorError> {
    let mut reg = state.0.lock().map_err(|_| EditorError::LockPoisoned)?;
    let b = reg.active_buffer_mut()?;
    let text = b.text();
    let value: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|e| EditorError::Other(format!("not valid JSON: {e}")))?;
    let pretty =
        serde_json::to_string_pretty(&value).map_err(|e| EditorError::Other(e.to_string()))?;
    b.replace_document(&pretty)
}

#[tauri::command]
pub fn pos_to_char(
    line: usize,
    col: usize,
    state: State<EditorState>,
) -> Result<usize, EditorError> {
    Ok(state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer()?
        .pos_to_char(line, col))
}

#[tauri::command]
pub fn char_to_pos(char_idx: usize, state: State<EditorState>) -> Result<CaretPos, EditorError> {
    Ok(state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer()?
        .char_to_pos(char_idx))
}

#[tauri::command]
pub fn read_range(
    start: usize,
    end: usize,
    state: State<EditorState>,
) -> Result<String, EditorError> {
    state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer()?
        .read_range(start, end)
}

#[tauri::command]
pub fn search(
    query: String,
    use_regex: bool,
    case_sensitive: bool,
    state: State<EditorState>,
) -> Result<Vec<[usize; 2]>, EditorError> {
    state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer()?
        .search(&query, use_regex, case_sensitive)
}

#[derive(Serialize)]
pub struct ReplaceResult {
    pub meta: DocumentMeta,
    pub count: usize,
}

#[tauri::command]
pub fn replace_all(
    query: String,
    use_regex: bool,
    case_sensitive: bool,
    replacement: String,
    state: State<EditorState>,
) -> Result<ReplaceResult, EditorError> {
    let (meta, count) = state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer_mut()?
        .replace_all(&query, use_regex, case_sensitive, &replacement)?;
    Ok(ReplaceResult { meta, count })
}

/// The current byte length of a file on disk, for follow/tail to detect growth cheaply.
#[tauri::command]
pub fn file_len(path: String) -> Result<u64, EditorError> {
    Ok(std::fs::metadata(&path)?.len())
}

/// Re-open the active tab's file from disk, replacing its buffer (used by follow/tail
/// when the file has grown). Re-selects the engine by current size, so a log that
/// crosses the large-file threshold keeps working. Discards unsaved edits by design
/// — follow is for watching a changing file, not editing it.
#[tauri::command]
pub fn reload(dark: bool, state: State<EditorState>) -> Result<DocumentMeta, EditorError> {
    let mut reg = state.0.lock().map_err(|_| EditorError::LockPoisoned)?;
    let id = reg.active.ok_or(EditorError::NoActiveDocument)?;
    let path = reg
        .tabs
        .iter()
        .find(|t| t.id == id)
        .and_then(|t| t.path.clone())
        .ok_or(EditorError::NoPath)?;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let mut buffer: Box<dyn Buffer> = if size >= mmapbuf::MMAP_THRESHOLD_BYTES {
        Box::new(mmapbuf::MmapBuffer::default())
    } else {
        Box::new(RopeBuffer {
            dark,
            ..Default::default()
        })
    };
    buffer.open(&path)?;
    let meta = buffer.meta();
    if let Some(t) = reg.tabs.iter_mut().find(|t| t.id == id) {
        t.buffer = buffer;
    }
    Ok(meta)
}

/// Lines matching a regex, for the live filter-to-view (works on both engines, so a
/// huge log can be filtered too). Capped at `MAX_FILTER_MATCHES`.
#[tauri::command]
pub fn filter_lines(
    query: String,
    use_regex: bool,
    case_sensitive: bool,
    state: State<EditorState>,
) -> Result<Vec<FilterMatch>, EditorError> {
    state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer()?
        .filter(&query, use_regex, case_sensitive)
}

/// List one directory's immediate children (the file tree expands lazily per folder).
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, EditorError> {
    const SKIP: [&str; 4] = [".git", "node_modules", "target", ".DS_Store"];
    let mut entries = Vec::new();
    for e in std::fs::read_dir(&path)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().into_owned();
        if SKIP.contains(&name.as_str()) {
            continue;
        }
        let is_dir = e.file_type().map(|f| f.is_dir()).unwrap_or(false);
        entries.push(DirEntry {
            name,
            path: e.path().display().to_string(),
            is_dir,
        });
    }
    // Folders first, then case-insensitive by name.
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// The user's home directory, for the file tree's cold-start default.
#[tauri::command]
pub fn home_dir() -> Option<String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .filter(|s| !s.is_empty())
}

/// The active document's outline for the outline panel.
#[tauri::command]
pub fn get_outline(state: State<EditorState>) -> Result<Vec<OutlineItem>, EditorError> {
    Ok(state
        .0
        .lock()
        .map_err(|_| EditorError::LockPoisoned)?
        .active_buffer()?
        .outline())
}

#[tauri::command]
pub fn refresh_highlights(state: State<EditorState>) -> Result<DocumentMeta, EditorError> {
    let mut reg = state.0.lock().map_err(|_| EditorError::LockPoisoned)?;
    let b = reg.active_buffer_mut()?;
    b.rehighlight();
    Ok(b.meta())
}

/// Switch the syntax-highlight theme (dark vs light) across all open tabs,
/// re-highlighting each in place (no disk reload, so unsaved edits are safe).
/// Returns the active document's meta so the viewport refreshes, or `None` when
/// nothing is open.
#[tauri::command]
pub fn set_theme(
    dark: bool,
    state: State<EditorState>,
) -> Result<Option<DocumentMeta>, EditorError> {
    let mut reg = state.0.lock().map_err(|_| EditorError::LockPoisoned)?;
    for tab in reg.tabs.iter_mut() {
        tab.buffer.set_dark(dark);
    }
    Ok(reg.active_buffer().ok().map(|b| b.meta()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewport_returns_requested_lines() {
        let mut b = RopeBuffer::default();
        b.insert(0, "one\ntwo\nthree\n").unwrap();
        let vp = b.viewport(1, 1).unwrap();
        assert_eq!(vp[0].text, "two\n");
        assert!(!vp[0].truncated);
    }

    #[test]
    fn viewport_clamps_past_the_end() {
        let mut b = RopeBuffer::default();
        b.insert(0, "a\nb\n").unwrap();
        // Asking for more lines than exist returns what is there, not an error.
        assert!(b.viewport(0, usize::MAX).is_ok());
    }

    #[test]
    fn edits_change_length_and_content() {
        let mut b = RopeBuffer::default();
        let after_insert = b.insert(0, "abc").unwrap();
        assert_eq!(after_insert.char_count, 3);
        let after_delete = b.delete(0, 1).unwrap();
        assert!(after_delete.dirty);
        assert_eq!(b.viewport(0, 1).unwrap()[0].text, "bc");
    }

    #[test]
    fn highlights_rust_source() {
        let s = highlight::highlight_doc("fn main() {}\n", "rs", false);
        assert!(s.is_some(), "two-face should know Rust");
        assert!(s.unwrap().iter().any(|line| !line.is_empty()));
    }

    #[test]
    fn highlights_common_types_with_varied_colours() {
        for (text, ext) in [
            ("# Heading\n\n**bold** text\n", "md"),
            ("[package]\nname = \"x\"\n", "toml"),
            ("$x = 1\nWrite-Host $x\n", "ps1"),
        ] {
            let spans = highlight::highlight_doc(text, ext, false)
                .unwrap_or_else(|| panic!("no syntax for .{ext}"));
            let colours: std::collections::HashSet<_> =
                spans.iter().flatten().map(|s| s.color.clone()).collect();
            assert!(
                colours.len() > 1,
                ".{ext} produced only one colour: {colours:?}"
            );
        }
    }

    #[test]
    fn long_lines_are_capped_but_report_true_length() {
        let mut b = RopeBuffer::default();
        let long = "a".repeat(MAX_VIEWPORT_LINE + 500);
        b.insert(0, &long).unwrap();
        let vp = b.viewport(0, 1).unwrap();
        assert!(vp[0].truncated);
        assert_eq!(vp[0].text.chars().count(), MAX_VIEWPORT_LINE);
        assert_eq!(vp[0].chars, MAX_VIEWPORT_LINE + 500);
    }

    #[test]
    fn insert_past_end_is_rejected() {
        let mut b = RopeBuffer::default();
        assert!(b.insert(5, "x").is_err());
    }

    #[test]
    fn delete_out_of_bounds_is_rejected() {
        let mut b = RopeBuffer::default();
        b.insert(0, "abc").unwrap();
        assert!(b.delete(0, 99).is_err());
        assert!(b.delete(2, 1).is_err());
    }

    #[test]
    fn caret_conversions_handle_lines_and_multibyte() {
        let mut b = RopeBuffer::default();
        // "héllo" is 5 characters (é is one char); then a newline, then "wörld".
        b.insert(0, "héllo\nwörld\n").unwrap();

        // Column past the end of a line clamps to the line end (before the break).
        assert_eq!(b.pos_to_char(0, 100), 5);
        // Start of the second line is after the 5 chars + the newline.
        assert_eq!(b.pos_to_char(1, 0), 6);

        // Round-trips.
        let p = b.char_to_pos(5);
        assert_eq!((p.line, p.col), (0, 5));
        let q = b.char_to_pos(6);
        assert_eq!((q.line, q.col), (1, 0));

        // A line index past the end clamps to the last line.
        let far = b.pos_to_char(999, 0);
        assert_eq!(far, b.rope.line_to_char(b.rope.len_lines() - 1));
    }

    // A unique path in the temp dir for a save test (no tempfile crate dependency).
    fn tmp_target(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("tuhi-{tag}-{}-{nanos}", std::process::id()))
    }

    // Any leftover ".{base}.tuhi-tmp-*" siblings from an atomic save (scoped to `base`
    // so parallel tests don't interfere).
    fn temp_leftovers(dir: &std::path::Path, base: &str) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(base) && n.contains(".tuhi-tmp-"))
            .collect()
    }

    #[test]
    fn save_writes_then_overwrites_atomically() {
        let path = tmp_target("save").with_extension("txt");
        let p = path.display().to_string();
        let dir = path.parent().unwrap().to_path_buf();
        let base = path.file_name().unwrap().to_string_lossy().into_owned();

        let mut b = RopeBuffer::default();
        b.insert(0, "first version\n").unwrap();
        let meta = b.save(Some(p.clone())).unwrap();
        assert!(!meta.dirty);
        assert_eq!(fs::read_to_string(&path).unwrap(), "first version\n");

        // Overwrite in place: the rename replaces the original.
        b.insert(b.rope.len_chars(), "second line\n").unwrap();
        b.save(Some(p.clone())).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "first version\nsecond line\n"
        );

        assert!(
            temp_leftovers(&dir, &base).is_empty(),
            "temp files left behind"
        );
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn opens_non_utf8_file_and_round_trips_on_save() {
        // A Latin-1 log line with 0xE9 ('é'), which is invalid lone UTF-8 and would
        // have hard-failed the old `Rope::from_reader` open path.
        let path = tmp_target("latin1").with_extension("log");
        let original: Vec<u8> = vec![b'c', b'a', b'f', 0xE9, b' ', b'l', b'o', b'g', b'\n'];
        fs::write(&path, &original).unwrap();

        let mut b = RopeBuffer::default();
        b.open(&path.display().to_string()).unwrap();
        assert_eq!(b.encoding, Encoding::Latin1);
        assert_eq!(b.rope.to_string(), "café log\n");

        // Saving re-encodes as Latin-1, so the bytes are identical to the original.
        b.save(None).unwrap();
        assert_eq!(fs::read(&path).unwrap(), original);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn failed_save_leaves_original_intact() {
        // Target an existing directory so the final rename fails: the save must error,
        // must not destroy anything, and must not leave a temp file behind.
        let sub = tmp_target("save-dir");
        fs::create_dir(&sub).unwrap();
        let dir = sub.parent().unwrap().to_path_buf();
        let base = sub.file_name().unwrap().to_string_lossy().into_owned();

        let mut b = RopeBuffer::default();
        b.insert(0, "data\n").unwrap();
        let res = b.save(Some(sub.display().to_string()));

        assert!(res.is_err(), "saving onto a directory should fail");
        assert!(
            sub.is_dir(),
            "the original must still be there after a failed save"
        );
        assert!(
            temp_leftovers(&dir, &base).is_empty(),
            "temp files left behind"
        );
        let _ = fs::remove_dir(&sub);
    }

    #[test]
    fn undo_redo_insert_and_delete() {
        let mut b = RopeBuffer::default();
        b.insert(0, "hello").unwrap(); // one change (single insert call)
        b.delete(0, 1).unwrap(); // -> "ello"
        assert_eq!(b.rope.to_string(), "ello");

        // Undo the delete: "h" comes back, caret after it.
        assert_eq!(b.undo().unwrap(), Some(1));
        assert_eq!(b.rope.to_string(), "hello");
        // Undo the insert: back to empty.
        assert_eq!(b.undo().unwrap(), Some(0));
        assert_eq!(b.rope.to_string(), "");
        // Nothing left to undo.
        assert_eq!(b.undo().unwrap(), None);

        // Redo both in order.
        b.redo().unwrap();
        assert_eq!(b.rope.to_string(), "hello");
        b.redo().unwrap();
        assert_eq!(b.rope.to_string(), "ello");
        assert_eq!(b.redo().unwrap(), None);
    }

    #[test]
    fn contiguous_typing_coalesces_into_one_undo_step() {
        let mut b = RopeBuffer::default();
        // Type h-e-l-l-o as five contiguous single-char inserts.
        for (i, ch) in "hello".chars().enumerate() {
            b.insert(i, &ch.to_string()).unwrap();
        }
        assert_eq!(b.rope.to_string(), "hello");
        // One undo removes the whole typed run.
        b.undo().unwrap();
        assert_eq!(b.rope.to_string(), "");
        assert_eq!(b.undo().unwrap(), None);
    }

    #[test]
    fn newline_breaks_the_coalesced_run() {
        let mut b = RopeBuffer::default();
        b.insert(0, "a").unwrap();
        b.insert(1, "\n").unwrap(); // ends a run
        b.insert(2, "b").unwrap(); // starts a fresh run
        assert_eq!(b.rope.to_string(), "a\nb");
        b.undo().unwrap();
        assert_eq!(b.rope.to_string(), "a\n");
        b.undo().unwrap();
        assert_eq!(b.rope.to_string(), "a");
        b.undo().unwrap();
        assert_eq!(b.rope.to_string(), "");
    }

    #[test]
    fn replace_document_pretty_prints_and_undoes() {
        let mut b = RopeBuffer::default();
        let minified = "{\"a\":1,\"b\":[2,3]}";
        b.insert(0, minified).unwrap();
        // The command's core: parse JSON, pretty-print, replace the document.
        let value: serde_json::Value = serde_json::from_str(b.text().trim()).unwrap();
        let pretty = serde_json::to_string_pretty(&value).unwrap();
        b.replace_document(&pretty).unwrap();
        assert!(b.rope.to_string().starts_with("{\n"), "should be indented");
        assert!(b.rope.len_lines() > 1);
        // One undo restores the original minified text.
        b.undo().unwrap();
        assert_eq!(b.rope.to_string(), minified);
    }

    #[test]
    fn a_new_edit_clears_the_redo_stack() {
        let mut b = RopeBuffer::default();
        b.insert(0, "abc").unwrap();
        b.undo().unwrap();
        assert_eq!(b.rope.to_string(), "");
        // Typing again discards the redo history.
        b.insert(0, "x").unwrap();
        assert_eq!(b.redo().unwrap(), None);
        assert_eq!(b.rope.to_string(), "x");
    }

    #[test]
    fn empty_document_operations_are_safe() {
        let mut b = RopeBuffer::default();
        let vp = b.viewport(0, 10).unwrap();
        assert_eq!(vp.len(), 1); // an empty rope is one empty line
        assert_eq!(vp[0].text, "");
        assert_eq!(b.pos_to_char(0, 0), 0);
        assert_eq!(b.pos_to_char(5, 5), 0); // clamps past the end
        let p = b.char_to_pos(0);
        assert_eq!((p.line, p.col), (0, 0));
        assert!(b.delete(0, 0).is_ok()); // no-op delete
        assert!(b.read_range(0, 0).unwrap().is_empty());
    }

    #[test]
    fn crlf_lines_and_caret_clamp() {
        let mut b = RopeBuffer::default();
        b.insert(0, "a\r\nb\r\n").unwrap();
        assert_eq!(b.rope.len_lines(), 3); // "a\r\n", "b\r\n", ""
        // A column past the end of line 0 clamps before the \r\n (after "a").
        assert_eq!(b.pos_to_char(0, 100), 1);
        // Line 1 starts after "a\r\n" (3 chars).
        assert_eq!(b.pos_to_char(1, 0), 3);
    }

    #[test]
    fn astral_chars_count_as_one_char() {
        let mut b = RopeBuffer::default();
        b.insert(0, "a😀b").unwrap(); // the emoji is one Unicode scalar == one ropey char
        assert_eq!(b.rope.len_chars(), 3);
        let p = b.char_to_pos(2);
        assert_eq!((p.line, p.col), (0, 2));
        b.delete(1, 2).unwrap(); // remove just the emoji
        assert_eq!(b.rope.to_string(), "ab");
    }

    #[test]
    fn many_edits_then_full_undo_terminates() {
        let mut b = RopeBuffer::default();
        for i in 0..200 {
            let at = b.rope.len_chars();
            b.insert(at, if i % 20 == 19 { "\n" } else { "x" }).unwrap();
        }
        assert_eq!(b.rope.len_chars(), 200);
        let mut guard = 0;
        while b.undo().unwrap().is_some() {
            guard += 1;
            assert!(guard < 1000, "undo did not terminate");
        }
        assert_eq!(b.rope.to_string(), "");
    }
}
