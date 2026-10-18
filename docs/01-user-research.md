# User research — what people love, and what they want fixed

_Research run 2026-10-18 (web search + fetch). Reddit searches returned nothing this run (index gap), so user-voice comes from Hacker News, the Notepad++ community forum, cplusplus.com, G2/GetApp/AlternativeTo/StackShare and Lemmy — a fair proxy for Reddit-style sentiment, not Reddit itself. Several bug/limit threads date 2018-2022 and may be partly addressed now; flagged where it matters._

## What users LOVE (ranked by how often it recurs)

1. **Speed, light footprint, instant startup.** By far the most repeated praise and the core of the product's identity. A rebuild must not lose this.
   - _Counterpoint for honesty:_ the moat is narrower than it was. A Lemmy user notes VS Code now starts in ~1s; the instant-open advantage matters most on low-RAM machines and for "open-glance-close" use.
2. **Regex Find/Replace + Find-in-Files across a directory.** The feature people say they'd miss most. Also flagged as high-risk (one bad pattern rewrites many files) → **UX opportunity: dry-run/preview + robust undo.**
3. **Plugin ecosystem**, with specific "killer" plugins named repeatedly — Compare, and BetterMultiSelection for proper multi-cursor.
4. **Tabbed multi-doc, broad syntax highlighting, encoding/EOL handling.** Praised for showing unprintable characters VS Code hides.
5. **Column/block editing + multi-cursor** (with the caveat below).
6. **Free, open-source, portable, no-admin.**
7. **Macros** (record/playback).

## What users want FIXED (ranked)

1. **Dated UI — the #1 complaint and the #1 wish.** But contested: a vocal faction says "modernise the look, do NOT add a Ribbon / do NOT make it heavier." The want is **modern look + ergonomics, not more weight.** Our wedge: _modern UI without the Electron tax._
2. **Cross-platform (Mac/Linux).** The biggest structural gap and the clearest opportunity. Demand pushes people to Sublime/VS Code/Geany/Kate/Lite XL today.
3. **Large-file handling.** The ~2 GB cap and slowness well below it drive users to Vim/klogg/less. **Memory-mapped / virtualised rendering for huge files & logs is a concrete differentiator.**
4. **Settings/config friction** — confusing menu, poor defaults, apparent resets. A clean, discoverable, synced settings model is an easy win.
5. **Crash-safe session persistence.** Users treat it as a scratchpad and expect unsaved buffers to survive a crash/restart; today they don't, reliably.
6. **Modern multi-cursor out of the box** (VS Code-style), not plugin-dependent.
7. **Optional LSP** (the modern middle path between "plain editor" and "IDE").
8. **Smoother plugin management** (Plugins Admin is fragile in portable/AV/admin scenarios).
9. **Cloud/collaboration** — repeatedly listed, but lower priority and arguably off-mission for a lightweight editor.

**Dark mode** is now largely solved in 8.x → ship it polished from day one, but it is **not** a differentiator.

## The opportunity, in one line

People love Notepad++ for **instant-open speed, directory-wide regex search, encoding/format muscle, and plugins**, and resent that it is **Windows-only, visually dated, ~2 GB-capped, fiddly to configure, and occasionally loses sessions.** The clean wedge: _the loved feature set, delivered cross-platform with a modern-but-light UI and genuine large-file capability, without surrendering the instant feel._

_Sources: G2 (g2.com/products/notepad/reviews), StackShare, HN Algolia, Notepad++ community forum (community.notepad-plus-plus.org), cplusplus.com forum, AlternativeTo, GetApp, Technipages, Privacy Guides forum, Lemmy — all harvested 2026-10-18._
