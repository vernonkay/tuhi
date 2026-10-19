# tuhi — a fast, cross-platform text & Markdown editor

A modern, fast, **cross-platform**, open-source text/code editor that also treats **Markdown** as a first-class citizen, the loved parts of Notepad++ rebuilt portable and modern, without becoming an IDE or a knowledge-base.

> **tuhi** is te reo Māori for *to write, to inscribe, to record.* The one small known collision is an inactive GNOME tablet utility of the same name (not an editor).

Vernon Kay's first open-source project. Personal, developed independently; its public home is a personal GitHub account.

## Why this exists (the thesis)

Line the editor field up against five attributes, fast/native (not Electron), truly cross-platform, open-source and free, simple-by-default yet extensible, and first-class Markdown with live preview, and **no single product scores on all five**. Notepad++ fails cross-platform and modern Markdown; NotepadNext is cross-platform but under-resourced; Sublime is native but closed/paid; VS Code is cross-platform but heavy; Typora nails Markdown but is closed; the OSS Markdown editors are all Electron or stalled. That intersection is the gap. (Full analysis in `docs/`.)

## Status (2026-10-19)

Early but usable. A Rust editing core (a `ropey` rope buffer, plus a read-only memory-mapped engine for huge files) sits behind a `Buffer` trait, with a virtualised web-view that fetches only the on-screen lines: open / edit / save, tabs, a file tree, syntax highlighting, find/replace. Heading for a first public release (**v0.1.0**) that leads with large-file handling. A public `ROADMAP.md` lands before release.

## Tech stack

- **Tauri** (Rust core + web UI), small native binaries, cross-platform, modern UI without Electron's weight. ADR-0001.
- **Editing core: a Rust rope engine** (`ropey`), the text buffer lives in Rust, the web-view renders only the visible viewport; large files (no ~2 GB Notepad++ cliff) are the point. Chosen deliberately over a web editor. ADR-0002.
- Syntax highlighting: **tree-sitter** (planned).

## Repository layout

```
tuhi/
├── README.md
├── LICENSE-MIT / LICENSE-APACHE
├── docs/                     # research + scope ("base point scope")
│   ├── 00-current-state-notepadpp.md
│   ├── 01-user-research.md
│   ├── 02-competitive-landscape.md
│   ├── 03-engineering-practices.md
│   ├── 04-product-scope.md
│   └── decisions/            # ADRs (0001 stack, 0002 editing core)
├── brand/                    # logo + brand assets
├── app/                      # the Tauri application
│   ├── src/                  #   web UI (React/TS)
│   └── src-tauri/            #   Rust: editor core in src/editor/
├── scripts/                  # dev + check scripts (just-driven)
├── justfile                  # task runner
└── .github/                  # CI + PR template
```

## Working on it

Bootstrap once with `just setup` (installs the git hooks and the frontend deps; or `npm install` in `app/`), then `just dev` to run and `just check` before pushing. Builds write to a separate checkout outside the synced drive, so build output doesn't thrash cloud sync.

## Licence

Dual-licensed under **MIT OR Apache-2.0**, at your option (permissive, the Rust-ecosystem norm). See [`LICENSE-MIT`](LICENSE-MIT) and [`LICENSE-APACHE`](LICENSE-APACHE). Contributions are accepted under the same dual licence.

## Built with AI assistance

tuhi is built by Vernon Kay with heavy use of AI assistance (Claude Code). The code, the decisions and the responsibility are the author's; the AI is a tool, disclosed here rather than credited per commit (see `AGENTS.md`).

## Provenance

Research strands run 2026-10-18 via web search and fetch, plus a read of a prior codebase for generic engineering discipline only (no third-party code or config lifted). Sources cited inline in `docs/`.
