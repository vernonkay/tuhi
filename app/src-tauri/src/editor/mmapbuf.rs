//! Large-file engine, read-only first cut (feature 3 / ADR-0003).
//!
//! Opens a file with `mmap` and builds only a newline index, so the bytes are
//! never copied into the heap: resident memory is the index (~8 bytes per line)
//! plus whatever the OS pages in for the visible window. This is what lets a
//! multi-GB file open instantly and scroll, which `RopeBuffer` (whole file in
//! RAM) cannot. Editing on this engine (the full piece tree) is the next step;
//! for now it is read-only, and the UI reflects that.

use super::{Buffer, CaretPos, DocumentMeta, ViewportLine, MAX_VIEWPORT_LINE};
use memmap2::Mmap;
use std::fs::File;
use std::path::PathBuf;

/// Files at or above this size open on the mmap engine instead of `RopeBuffer`.
pub const MMAP_THRESHOLD_BYTES: u64 = 25 * 1024 * 1024;

const READ_ONLY: &str = "this file is open read-only (large-file mode)";

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
    fn open(&mut self, path: &str) -> Result<DocumentMeta, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        // SAFETY: a read-only map of a file we do not also write. If the file is
        // changed underneath us the view may be inconsistent; acceptable for a
        // read-only viewer.
        let mmap = unsafe { Mmap::map(&file).map_err(|e| e.to_string())? };
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

    fn viewport(&self, start: usize, count: usize) -> Result<Vec<ViewportLine>, String> {
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
                let b = self.line_starts.get(i + 1).copied().unwrap_or(self.len_bytes);
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
    fn insert(&mut self, _char_idx: usize, _text: &str) -> Result<DocumentMeta, String> {
        Err(READ_ONLY.into())
    }
    fn delete(&mut self, _start: usize, _end: usize) -> Result<DocumentMeta, String> {
        Err(READ_ONLY.into())
    }
    fn save(&mut self, _path: Option<String>) -> Result<DocumentMeta, String> {
        Err(READ_ONLY.into())
    }
    fn replace_all(
        &mut self,
        _query: &str,
        _regex: bool,
        _case_sensitive: bool,
        _replacement: &str,
    ) -> Result<(DocumentMeta, usize), String> {
        Err(READ_ONLY.into())
    }
    fn search(
        &self,
        _query: &str,
        _regex: bool,
        _case_sensitive: bool,
    ) -> Result<Vec<[usize; 2]>, String> {
        Err("find is not available in large-file mode yet".into())
    }
    fn read_range(&self, _start: usize, _end: usize) -> Result<String, String> {
        Err(READ_ONLY.into())
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
