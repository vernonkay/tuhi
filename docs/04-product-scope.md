# Product scope — what WE are building

_Synthesis of `00`–`03`, as-at 2026-10-18. This is the document the other four exist to justify. It states the thesis, what's in and out, the MVP, the decided stack, and the decisions still open for Vernon._

## Thesis

Build the **one editor that collapses two apps most people split**: the fast, simple, cross-platform scratch/code text editor (Notepad++/Sublime territory) **and** a clean local-Markdown writing surface (Typora territory) — delivered **native-fast and open-source**, which nothing currently is simultaneously. Simple by default, powerful on demand. Explicitly **not** an IDE, **not** a knowledge-base/vault, **not** a modal editor.

## Design principles (what we will not trade away)

1. **Instant open stays sacred.** Startup and keystroke latency are features. No blocking I/O on the UI thread (we'll make that a lint rule, per `03`).
2. **Simple by default; depth is opt-in** via plugins/settings, never forced into the first-run experience.
3. **Cross-platform from commit #1** — Windows, macOS, Linux as peers. This is the whole reason to exist; never let it become a Windows app with ports.
4. **Local plain files, no lock-in.** `.txt`, `.md`, source files on disk. No mandatory vault, account or cloud.
5. **Neutral and trustworthy.** Signed, verifiable auto-update; no editorial content in releases; no surprise telemetry. (A direct answer to Notepad++'s governance baggage.)

## In scope (the loved baseline + the modern fixes)

**Must match Notepad++ (don't regress the reasons people love it):**
- Tabbed multi-document editing; split view.
- Syntax highlighting + folding for a broad language set; user-defined languages.
- **Regex Find/Replace + Find-in-Files** — with a **dry-run/preview + robust undo** (fixing the "one bad pattern rewrites everything" risk).
- Strong encoding + EOL handling.
- Column/block editing + **modern VS Code-style multi-cursor out of the box** (no plugin needed).
- Macros; line operations (sort/dedupe/case).
- Polished dark mode + Windows/OS theme follow from day one (table-stakes).
- Portable build; no admin required.

**Modern fixes that are the point:**
- **Cross-platform** (the headline).
- **Large-file capability** — memory-mapped / virtualised rendering for multi-GB files & logs. Target: open and scroll a 5GB log smoothly; no `INT_MAX` cliff.
- **Clean, discoverable, synced settings** (no confusing menu, no silent resets).
- **Crash-safe session persistence** by default — unsaved buffers survive a crash/restart.
- **Optional LSP** as the editor↔IDE middle path (off by default).

**Markdown as a first-class mode (the second job):**
- Hybrid live preview / inline WYSIWYG (Typora-grade), toggleable; source view always available.
- Mermaid diagrams, KaTeX math, assisted tables, code-block highlighting.
- Pandoc export to PDF/DOCX/HTML.
- Optional `[[wikilinks]]`/backlinks — **available, not imposed** (no forced vault/graph).

## Out of scope (at least for v1 — say no on purpose)

- Full IDE (debuggers, build systems, deep IntelliSense) — LSP is the ceiling.
- Vault/graph/outliner PKM paradigm.
- Modal (Vim-style) editing as the default (a keymap can come later).
- Real-time collaboration / cloud sync.
- **AI features as a headline.** Optional, local-friendly plugin only — Microsoft is commoditising this in the OS; it's a liability for the minimalist crowd.

## Stack (decided 2026-10-18)

**Tauri** — Rust core + web UI (React/TS scaffolded under `app/`).
- **Why:** small native binaries, true cross-platform, modern UI without Electron's RAM/startup tax (the exact thing N++ users mock VS Code for). Keeps the "instant feel" honest while letting us build a modern UI fast.
- **Trade-offs acknowledged:** steeper Rust curve than Electron; the web-view UI layer must be disciplined to protect latency (hence the no-blocking-UI lint rule). Electron was rejected (bloat is the enemy here); native Qt/C++ was rejected (what NotepadNext uses — heavier to iterate, smaller contributor pool), though it remains the fallback if the web-view can't hit our latency bar for huge files.
- **Editing core — OPEN:** the biggest architectural question (below).

## Open decisions for Vernon

1. **Editing core — DECIDED 2026-10-18: Option B, the Rust rope engine** (`ropey` in `app/src-tauri`, web-view renders the viewport, tree-sitter highlighting). Chosen over the faster web-editor path because this is a first OSS project meant to be built properly and because the rope is what makes the large-file differentiator real. See `docs/decisions/0002-editing-core-options.md`, including the Xi-editor failure analysis and the guardrails against repeating it.
2. **Build vs fork NotepadNext.** Adopt-and-resource it (Qt/C++, cross-platform, Scintilla, but single-maintainer/unstable) vs greenfield in Tauri. _My lean: greenfield — NotepadNext validates the concept but its stack (Qt/C++) and state don't give us the modern UI or the Markdown layer cheaply._
3. **Name & brand.** Not "Notepad++" (GPL + brand), not "NotepadNext" (taken). Needs its own identity before any public release. (Can park until there's something to show.)
4. **Licence.** Recommend permissive **MIT OR Apache-2.0 dual** (matches the Rust ecosystem norm, and notably what PhotoCraft/WordCraft use) rather than GPL — lowers the barrier to "used by many" and to any future DataTorque involvement. Your call, and it's easier to pick now than to relicense later.
5. **Personal vs DataTorque product — DECIDED 2026-10-18: personal.** Vernon's own project. Structural consequences, set from the outset:
   - **Not DataTorque IP and not on GHE.** Any remote lives on Vernon's *personal* GitHub, never `datatorque.ghe.com`. Keep DataTorque code, brand and internal practices out of it (we borrow dt-platform's generic engineering *discipline*, not its code or config).
   - **Repo home:** local at `C:\Users\vernonk\dev\notepad-refresh` (outside OneDrive so build output doesn't thrash sync). Not under `workspace/` (that's DataTorque's AI-OS tree) and not in a synced personal drive (build output).
   - **Commit identity:** must be Vernon's *personal* identity, not `vernon.kay@datatorque.com`. The first commit (e18d7f7) used the DT email by default — to be corrected once Vernon gives a personal name/email.
   - **Not tracked in the DataTorque system (Ren/desk).** This is personal; it does not belong in the work decision queue or reading list.
   - **Licence:** Vernon's free choice as author. Recommend permissive **MIT OR Apache-2.0 dual** (Rust-ecosystem norm, best for "used by many"; also what PhotoCraft/WordCraft use). Pending confirmation before LICENSE files are added.

## MVP (first vertical slice to prove the thesis)

A single-window Tauri app that: opens/edits/saves a local file, with tabs, syntax highlighting, fast regex find/replace, and a **Markdown mode with live preview** — on **all three OSes**, launching in well under a second. That slice alone exercises the two differentiators (cross-platform + Markdown) on top of the loved baseline. Everything else (Find-in-Files, large-file engine, LSP, plugins) layers on after the slice proves the architecture.
