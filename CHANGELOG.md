# Changelog

All notable changes to tuhi are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — unreleased

First public release: a fast, cross-platform editor that leads with large-file handling.

### Added

- Rust editing core behind a `Buffer` trait: an in-memory rope (`ropey`) for normal
  files, and a read-only memory-mapped engine for files 25 MB and larger, so multi-GB
  files open and scroll with flat memory and no hard cliff.
- Virtualised web-view that fetches only the on-screen lines from the Rust buffer.
- Open / edit / save with multiple tabs; a char-indexed caret that is multibyte- and
  CRLF-safe.
- Atomic save: writes a temp file, fsyncs it, then renames over the target, so a failed
  write can never destroy the original.
- Encoding detection (UTF-8 with optional BOM, UTF-16 LE/BE, lossless Latin-1 fallback)
  so non-UTF-8 logs open and round-trip on save.
- Undo / redo with contiguous-typing coalescing.
- Syntax highlighting (`syntect`) for files under 2 MB, with custom Prism (dark) and
  Daylight (light) themes.
- Find and replace: regex and case toggles, replace-all.
- Large-file features: live filter-to-view (collapse to matching lines), follow/tail
  with saved pattern-to-colour highlighters, and one-key JSON pretty-print.
- Studio chrome: a full-height icon rail; a left panel that switches between a file
  tree and a collapsible outline; a command palette (Ctrl/Cmd+P); a resizable panel;
  and session restore (reopens the files you had open).
- A restrictive Content-Security-Policy.

[Unreleased]: https://github.com/vernonkay/tuhi/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vernonkay/tuhi/releases/tag/v0.1.0
