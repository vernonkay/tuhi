//! Large-file engine, read-only first cut (feature 3 / ADR-0003).
//!
//! Opens a file with `mmap` and builds only a newline index, so the bytes are
//! never copied into the heap: resident memory is the index (~8 bytes per line)
//! plus whatever the OS pages in for the visible window. This is what lets a
//! multi-GB file open instantly and scroll, which `RopeBuffer` (whole file in
//! RAM) cannot. Editing on this engine (the full piece tree) is the next step;
//! for now it is read-only, and the UI reflects that.

use super::{
    Buffer, CaretPos, DocumentMeta, EditorError, FilterMatch, MAX_VIEWPORT_LINE, ViewportLine,
};
use memmap2::Mmap;
use std::fs::File;
use std::path::PathBuf;

/// Files at or above this size open on the mmap engine instead of `RopeBuffer`.
pub const MMAP_THRESHOLD_BYTES: u64 = 25 * 1024 * 1024;

pub struct MmapBuffer {
    mmap: Option<Mmap>,
    path: Option<PathBuf>,
    /// Byte offset of the start of each line. Line `i` is
    /// `[line_starts[i], line_starts.get(i+1).unwrap_or(len_bytes))`.
    line_starts: Vec<usize>,
    len_bytes: usize,
}

impl Default for MmapBuffer {
    fn default() -> Self {
        Self {
            mmap: None,
            path: None,
            line_starts: vec![0],
            len_bytes: 0,
        }
    }
}

impl MmapBuffer {
    fn make_meta(&self) -> DocumentMeta {
        DocumentMeta {
            path: self.path.as_ref().map(|p| p.display().to_string()),
            line_count: self.line_starts.len(),
            // No global character index in read-only mode; report bytes as a proxy.
            char_count: self.len_bytes,
            dirty: false,
            readonly: true,
        }
    }
}

impl Buffer for MmapBuffer {
    fn open(&mut self, path: &str) -> Result<DocumentMeta, EditorError> {
        let file = File::open(path)?;
        // SAFETY: a read-only map of a file we do not also write. If the file is
        // changed underneath us the view may be inconsistent; acceptable for a
        // read-only viewer.
        let mmap = unsafe { Mmap::map(&file)? };
        let bytes = &mmap[..];

        let mut starts = Vec::with_capacity(1024);
        starts.push(0usize);
        for pos in memchr::memchr_iter(b'\n', bytes) {
            starts.push(pos + 1);
        }

        self.len_bytes = bytes.len();
        self.line_starts = starts;
        self.path = Some(PathBuf::from(path));
        let meta = self.make_meta();
        self.mmap = Some(mmap);
        Ok(meta)
    }

    fn viewport(&self, start: usize, count: usize) -> Result<Vec<ViewportLine>, EditorError> {
        let bytes = match &self.mmap {
            Some(m) => &m[..],
            None => return Ok(Vec::new()),
        };
        let total = self.line_starts.len();
        let end = start.saturating_add(count).min(total);
        let max_bytes = MAX_VIEWPORT_LINE * 4; // cap bytes decoded, so a huge line can't stall

        let lines = (start..end)
            .map(|i| {
                let a = self.line_starts[i];
                let b = self
                    .line_starts
                    .get(i + 1)
                    .copied()
                    .unwrap_or(self.len_bytes);
                let b = b.min(self.len_bytes).max(a);
                let raw = &bytes[a..b];
                let over_bytes = raw.len() > max_bytes;
                let slice = if over_bytes { &raw[..max_bytes] } else { raw };
                let decoded = String::from_utf8_lossy(slice);
                let char_count = decoded.chars().count();
                let over_chars = char_count > MAX_VIEWPORT_LINE;
                let text: String = if over_chars {
                    decoded.chars().take(MAX_VIEWPORT_LINE).collect()
                } else {
                    decoded.into_owned()
                };
                let shown = text.chars().count();
                ViewportLine {
                    text,
                    chars: shown,
                    truncated: over_bytes || over_chars,
                    spans: Vec::new(),
                }
            })
            .collect();
        Ok(lines)
    }

    // Read-only: editing is not supported on the large-file engine yet.
    fn insert(&mut self, _char_idx: usize, _text: &str) -> Result<DocumentMeta, EditorError> {
        Err(EditorError::ReadOnly)
    }
    fn delete(&mut self, _start: usize, _end: usize) -> Result<DocumentMeta, EditorError> {
        Err(EditorError::ReadOnly)
    }
    fn save(&mut self, _path: Option<String>) -> Result<DocumentMeta, EditorError> {
        Err(EditorError::ReadOnly)
    }
    fn replace_all(
        &mut self,
        _query: &str,
        _regex: bool,
        _case_sensitive: bool,
        _replacement: &str,
    ) -> Result<(DocumentMeta, usize), EditorError> {
        Err(EditorError::ReadOnly)
    }
    fn search(
        &self,
        _query: &str,
        _regex: bool,
        _case_sensitive: bool,
    ) -> Result<Vec<[usize; 2]>, EditorError> {
        Err(EditorError::Other(
            "find is not available in large-file mode yet".into(),
        ))
    }
    fn read_range(&self, _start: usize, _end: usize) -> Result<String, EditorError> {
        Err(EditorError::ReadOnly)
    }

    // Filter works read-only, so a huge log can be filtered to its matching lines.
    fn filter(
        &self,
        query: &str,
        use_regex: bool,
        case_sensitive: bool,
    ) -> Result<Vec<FilterMatch>, EditorError> {
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let bytes = match &self.mmap {
            Some(m) => &m[..],
            None => return Ok(Vec::new()),
        };
        let re = super::search::build_regex(query, use_regex, case_sensitive)
            .map_err(EditorError::Regex)?;
        let mut out = Vec::new();
        for i in 0..self.line_starts.len() {
            let a = self.line_starts[i];
            let b = self
                .line_starts
                .get(i + 1)
                .copied()
                .unwrap_or(self.len_bytes)
                .min(self.len_bytes)
                .max(a);
            let s = String::from_utf8_lossy(&bytes[a..b]);
            if re.is_match(&s) {
                let truncated = s.chars().count() > MAX_VIEWPORT_LINE;
                let text: String = if truncated {
                    s.chars().take(MAX_VIEWPORT_LINE).collect()
                } else {
                    s.into_owned()
                };
                out.push(FilterMatch {
                    line: i,
                    text,
                    truncated,
                });
                if out.len() >= super::MAX_FILTER_MATCHES {
                    break;
                }
            }
        }
        Ok(out)
    }

    // Caret math is not used while read-only (the UI hides the caret), but the
    // trait requires these; return harmless clamped values.
    fn pos_to_char(&self, line: usize, _col: usize) -> usize {
        self.line_starts.get(line).copied().unwrap_or(0)
    }
    fn char_to_pos(&self, _char_idx: usize) -> CaretPos {
        CaretPos { line: 0, col: 0 }
    }
    fn meta(&self) -> DocumentMeta {
        self.make_meta()
    }
    fn rehighlight(&mut self) {}
}
