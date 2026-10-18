# ADR 0001 — Tech stack: Tauri (Rust + web UI)

- Status: Accepted
- Date: 2026-10-18
- Decider: Vernon Kay

## Context
We are building a fast, cross-platform, open-source, simple-by-default text editor with first-class Markdown (see `docs/04-product-scope.md`). The non-negotiable is "instant feel" preserved across Windows/macOS/Linux. Candidate stacks: Tauri (Rust + web UI), Electron (TS), native Qt/C++.

## Decision
**Tauri.** Small native binaries, true cross-platform, modern UI without Electron's RAM/startup penalty (the exact failing Notepad++ users mock in VS Code).

## Consequences
- Steeper Rust learning curve than Electron.
- The web-view UI layer must be disciplined to protect latency → enforced by a lint rule banning blocking I/O on the UI thread.
- Electron rejected: bloat is the enemy of our core promise. Native Qt/C++ rejected: what NotepadNext uses — heavier to iterate, smaller contributor pool — but retained as the fallback if the web-view cannot hit the latency/large-file bar.

## Still open (do not treat as decided)
- Editing core: web editor (CodeMirror/Monaco) vs Rust rope engine (`ropey` + virtualised renderer) vs reused Scintilla. See `docs/04-product-scope.md` open decisions. This is the next ADR and the call that most shapes the project.
- Licence (recommend MIT OR Apache-2.0 dual), name/brand, and personal-vs-DataTorque-product status.
