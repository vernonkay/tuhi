# notepad-refresh (working title)

A modern, fast, **cross-platform**, open-source rebuild of the Notepad++ idea — a lightweight general-purpose text/code editor that *also* treats Markdown as a first-class citizen, without turning into an IDE or a knowledge-base.

> Working title only. We will **not** use the "Notepad++" name, logo or `++` identity (it is GPL and a distinct project's brand), and `NotepadNext` is already taken by the main existing reimplementation. Naming is an open decision — see `docs/04-product-scope.md`.

## Why this exists (the one-line thesis)

Line the whole editor field up against five attributes — fast/native (not Electron), truly cross-platform, open-source & free, simple-by-default yet extensible, and first-class Markdown with live preview — and **no single product scores on all five**. Notepad++ fails cross-platform and modern Markdown; NotepadNext is cross-platform but under-resourced and unstable; Sublime is native but closed/paid; VS Code is cross-platform but heavy; Typora nails Markdown but is closed and single-platform-feel; the OSS Markdown editors (Mark Text, Zettlr, Logseq) are all Electron or stalled. That intersection is the gap. (Full analysis: `docs/02-competitive-landscape.md`.)

## Status

Early scaffold — day one. Nothing is built yet. This repo currently holds the research and scope that justify the build, plus the engineering scaffolding.

## Tech stack (decided 2026-10-18)

**Tauri** (Rust core + web UI). Chosen for small native binaries, genuine cross-platform reach, and a modern UI without the Electron memory/startup penalty that Notepad++ users mock. See `docs/04-product-scope.md` for the trade-off vs Electron and native Qt/C++.

## Repository layout

```
notepad-refresh/
├── README.md                 # this file
├── docs/                     # research + scope (the "base point scope")
│   ├── 00-current-state-notepadpp.md   # what Notepad++ IS today (baseline)
│   ├── 01-user-research.md             # what users love and want fixed
│   ├── 02-competitive-landscape.md     # alternatives, Markdown editors, the gap
│   ├── 03-engineering-practices.md     # practices adopted from DT dt-platform
│   └── 04-product-scope.md             # what WE are building, MVP, open decisions
├── app/                      # the Tauri application (scaffolded separately)
└── scripts/, .github/        # engineering scaffolding (added incrementally)
```

## Provenance

Research strands were run on 2026-10-18 via web search/fetch and a read of DataTorque's `dt-platform` repo. Every non-obvious claim in `docs/` carries a source; items that could not be verified are flagged inline. Treat the numbers as sourced-as-at-18-Oct-2026, not eternal.
