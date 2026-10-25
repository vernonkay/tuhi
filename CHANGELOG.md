# Changelog

All notable changes to tuhi are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **New file** (<kbd>Ctrl/Cmd+N</kbd>): opens a fresh, empty, untitled document in its own
  tab; the first save prompts for a location (Save As). Reachable from the rail, the command
  palette and the welcome view.
- A visible **Format JSON** control in the rail — the one-key JSON pretty-print was
  previously only in the command palette, so it was easy to miss.

### Changed

- **Side panels dock beside the editor instead of floating over it.** The file-tree and
  outline panels now take their own column and the editor resizes to fit, so text is no
  longer hidden underneath a panel. On narrow or mobile widths they still float as an
  overlay. This also moves the outline panel out from under the window buttons.

### Fixed

- **Save As now renames its tab.** Saving a new untitled document kept the buffer and the
  tab's own path out of sync, so the tab stayed "untitled" and would not restore on the next
  launch; the tab now follows the saved file.

## [1.0.1] — 2026-10-24

A small, desktop-safe follow-up to 1.0.0, released so the launch-day download carries the
recovery-banner fix. It also lands the first mobile/touch adaptation layer, which is
confined to the mobile build and to narrow or touch viewports — the desktop app is
unchanged apart from the three items below.

### Fixed

- **Recovery banner layout.** The unsaved-work recovery bar now stacks above the editor
  instead of trying to share its row (`.workarea` lays out as a column), so it no longer
  crowds the editor on any window size.

### Added

- **A visible "Open a file…" button** on the empty / welcome view, next to the keyboard
  hint, so there is an obvious pointer-driven way in.
- **On-screen Cancel / Done buttons** for in-place Markdown block editing, alongside the
  existing <kbd>Ctrl/Cmd+Enter</kbd> and <kbd>Esc</kbd> shortcuts.
- **First mobile / touch responsive pass (Android build).** Overlay file-tree and outline
  panels, a condensed status bar, the recovery banner as a vertical card, finger-sized
  rail and action targets, safe-area insets for notch/status/nav bars, and auto-save after
  edits settle. All of this is gated to the mobile build (`IS_MOBILE`, by user agent) or to
  narrow / coarse-pointer viewports, so a touch-screen desktop keeps the full desktop
  behaviour — auto-save and hidden window controls never reach the desktop app.

## [1.0.0] — 2026-10-23

The 1.0 milestone: the large-file engine, Markdown mode and crash-safe editing are
considered stable, and the project is now marketed as a finished editor. Functionally this
is the 0.1.1 feature set declared 1.0; there are no behavioural changes to the app beyond
the version bump and the item below. Launched alongside a landing page
(<https://tuhi-editor.pages.dev>), a big-file demo, and Scoop / Homebrew install channels.

### Added

- **A favicon / app mark** derived from the caret logo, for the site and the app window.

## [0.1.1] — 2026-10-20

A correctness and polish release. **Upgrade strongly recommended:** 0.1.0 could corrupt
text under fast typing, so this supersedes it.

### Fixed

- **Typing corruption (critical).** Fast or sustained typing could insert characters at
  the wrong position and out of order (e.g. "the quick…" landing as "The qu rbkci"),
  because each keystroke read the caret from React state that lagged the buffer by two
  IPC round-trips. The caret, anchor and length are now tracked synchronously, edits are
  serialised, and typed characters are coalesced into one ordered insert per frame.
- **Caret alignment.** The caret is positioned by measuring the real rendered text of its
  line, so it no longer drifts right at the start of a line or left by the end.
- **Startup view** when a session is restored: the explorer now shows the active file's
  folder instead of the welcome buttons.

### Added

- **Settings v1**: a preferences panel with a theme override (Auto / Light / Dark) and
  management of the follow/tail highlighter rules.
- **Explorer**: a welcome view with Open File / Open Folder and a Recent list when nothing
  is open, and parent-folder navigation.

### Performance

- Large files (over the 2 MB highlight cap) no longer re-run the whole-document outline
  and highlight passes after every edit, which was stalling typing on big files.
- Fewer IPC round-trips per edit (insert now returns the caret; one round-trip per typing
  frame instead of several per keystroke).

### Changed

- Dependency bumps: `two-face`, `typescript`, and the `checkout`, `setup-node` and
  `setup-just` GitHub Actions.

## [0.1.0] — 2026-10-19

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

[Unreleased]: https://github.com/vernonkay/tuhi/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/vernonkay/tuhi/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/vernonkay/tuhi/compare/v0.1.1...v1.0.0
[0.1.1]: https://github.com/vernonkay/tuhi/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vernonkay/tuhi/releases/tag/v0.1.0
