# Tuhi

A modern, fast, **cross-platform**, open-source text/code editor that also treats **Markdown** as a first-class citizen, the loved parts of Notepad++ rebuilt portable and modern, without becoming an IDE or a knowledge-base.

> **Tuhi** is te reo Māori for *to write, to inscribe, to record.* Working name; the one small known collision is an inactive GNOME tablet utility of the same name (not an editor).

Vernon Kay's first open-source project. Personal, not DataTorque IP, not on `datatorque.ghe.com`; when it goes public it goes to a personal GitHub.

## Why this exists (the thesis)

Line the editor field up against five attributes, fast/native (not Electron), truly cross-platform, open-source and free, simple-by-default yet extensible, and first-class Markdown with live preview, and **no single product scores on all five**. Notepad++ fails cross-platform and modern Markdown; NotepadNext is cross-platform but under-resourced; Sublime is native but closed/paid; VS Code is cross-platform but heavy; Typora nails Markdown but is closed; the OSS Markdown editors are all Electron or stalled. That intersection is the gap. (Full analysis in `docs/`.)

## Status (2026-10-19)

Early build. The **editing core is in and proven**: a Rust `ropey` rope buffer with Tauri commands, compiling, unit tests green. Next: the front-end viewport renderer. See `BACKLOG.md`.

## Tech stack

- **Tauri** (Rust core + web UI), small native binaries, cross-platform, modern UI without Electron's weight. ADR-0001.
- **Editing core: a Rust rope engine** (`ropey`), the text buffer lives in Rust, the web-view renders only the visible viewport; large files (no ~2 GB Notepad++ cliff) are the point. Chosen deliberately over a web editor. ADR-0002.
- Syntax highlighting: **tree-sitter** (planned).

## Repository layout

```
tuhi/
├── README.md
├── BACKLOG.md                # task list (the next things to build)
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

This repo **is** the project's home. Start a session from this directory (not from a DataTorque workspace). Bootstrap once with `just setup` (or `npm install` in `app/`), then `just dev` to run, `just check` before pushing.

## Licence

Intended dual **MIT OR Apache-2.0** (permissive, Rust-ecosystem norm). Canonical LICENSE files to be added. Not yet public.

## Provenance

Research strands run 2026-10-18 via web search/fetch and a read of DataTorque's `dt-platform` (for generic engineering discipline only, no DT code). Sources cited inline in `docs/`.
