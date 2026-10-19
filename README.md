# tuhi

**A fast, cross-platform text & Markdown editor that opens multi-GB files.** Built in
Rust + Tauri: small native binaries, no Electron weight, and the loved parts of
Notepad++ rebuilt portable and modern, without becoming an IDE or a knowledge-base.

> **tuhi** is te reo Māori for *to write, to inscribe, to record*.

## Highlights

- **Huge files, no cliff.** Open and scroll multi-GB logs and data dumps with flat
  memory. Files 25 MB and up use a read-only memory-mapped engine; nothing has to load
  the whole file into the view.
- **Live filter-to-view.** Type a regex and the document collapses to just the matching
  lines, instantly, over any size, non-destructive.
- **Follow / tail + highlighters.** Follow a growing file as it's written, with saved
  pattern→colour rules (ERROR red, WARN amber).
- **One-key pretty-print.** Open a minified JSON blob that freezes other editors and
  reflow it with a keystroke.
- **A real editor underneath.** Tabs, undo/redo, find & replace (regex), syntax
  highlighting, a file tree, a collapsible outline, a command palette, session restore.
- **Safe by default.** Atomic save (a failed write can't destroy your file), encoding
  detection (UTF-8/BOM, UTF-16, Latin-1), a restrictive Content-Security-Policy.

## Demo

A short demo GIF is coming: open a multi-GB log, filter to `ERROR`, follow it live with
red highlights, then pretty-print a minified JSON file, all instantly.

## Install

Grab the installer for your OS from the [latest release](../../releases/latest):

- **Windows** — `.msi` or `.exe`
- **macOS** — `.dmg` (universal: Apple Silicon + Intel)
- **Linux** — `.AppImage`, `.deb`, or `.rpm`

**First-launch note (unsigned builds).** 0.1.0 ships unsigned, so your OS will warn
once:

- **Windows:** SmartScreen says "Windows protected your PC" → **More info** → **Run
  anyway**.
- **macOS:** Gatekeeper says the developer can't be verified → right-click the app →
  **Open** (or allow it in System Settings → Privacy & Security).

Signing is on the roadmap once there's traction.

## Build from source

Needs [Rust](https://rustup.rs), Node 20+, and the Tauri prerequisites for your OS.

```sh
just setup     # install git hooks + frontend deps
just dev       # run with hot reload
just build     # a release bundle for your OS
```

No `just`? The recipes just wrap `npm` in `app/` (`cd app && npm install`, then
`npm run tauri dev` / `npm run tauri build`).

## Status & roadmap

0.1.0 is the first public release. What's next (Markdown mode, viewport highlighting,
editable large files, and more) is in [`ROADMAP.md`](ROADMAP.md).

## Contributing

Issues and PRs welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md),
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and [`SECURITY.md`](SECURITY.md).

## Licence

Dual-licensed under **MIT OR Apache-2.0**, at your option, the Rust-ecosystem norm. See
[`LICENSE-MIT`](LICENSE-MIT) and [`LICENSE-APACHE`](LICENSE-APACHE).

## Built with AI assistance

tuhi is built by Vernon Kay with heavy use of AI assistance (Claude Code). The code, the
decisions and the responsibility are the author's; the AI is a tool, disclosed here
rather than credited per commit.
