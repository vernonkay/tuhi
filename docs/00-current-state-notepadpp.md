# Base point scope — what Notepad++ IS today

_As-at 2026-10-18. Purpose: a clear, honest baseline of the product we are refreshing, so every later decision is measured against what exists, not what we imagine exists._

## On this laptop (ground truth)

- Installed version: **8.9.6.4** (x64), installed 2026-04-06.
- Bundled plugins present: `mimeTools`, `NppConverter`, `NppExport` (plus a `Config` and `disabled` folder). This is the stock default plugin set — no third-party plugins added.
- User config lives at `%APPDATA%\Notepad++` (9 config/session files). Config is per-user XML, portable.

(The latest public release as-at today is **8.9.8.1**, 24 Sep 2026 — so this machine is two point-releases behind.)

## What it is, in one paragraph

Notepad++ is a Windows-only, C++ editor built directly on the **Win32 API + STL** (no cross-platform UI toolkit) with the **Scintilla/Lexilla** editing component at its core. That architecture is the source of both its great virtue (tiny footprint, near-instant startup) and its hard limit (it cannot leave Windows without a rewrite). GPL-licensed, free, portable, and carried by a single lead maintainer (Don Ho) since 2003.

## Architecture

| Layer | Today |
|---|---|
| Language | C++ |
| UI | Pure Win32 API + STL — **the thing that binds it to Windows** |
| Editing core | Scintilla (text buffer, lexing, folding) + Lexilla lexers. Tracked Scintilla 5.5.7 / Lexilla 5.4.5 as of v8.8.2. Scintilla is itself cross-platform and separately (permissively) licensed. |
| Plugins | C/C++ DLLs talking over Windows messages (`NPPM_` commands, `NPPN_` notifications). 140+ compatible plugins, ~10 ship by default. Built-in Plugins Admin (replaced the old third-party Plugin Manager, dropped at v7.6). |
| Builds | x86, x64, ARM64. Binaries code-signed (GlobalSign) from v8.8.7. |

## Feature inventory (the baseline we must not regress)

- Tabbed multi-document editing; split view / multi-view.
- Syntax highlighting + code folding for **78 languages**; user-defined languages.
- Regex Find/Replace; **Find in Files** (directory-wide search & replace) — a signature feature.
- Macros (record/playback).
- Column/block editing + multi-cursor (full parity historically needed the BetterMultiSelection plugin; v8.6.1 improved defaults).
- Character-encoding handling + EOL conversion (Windows/Unix/Mac) — genuinely strong, better than VS Code per users.
- Line operations (sort, dedupe, case).
- Session/tab persistence + backup / session snapshot.
- **Dark mode**, including auto-follow of the Windows light/dark setting with per-mode themes (v8.4.8+). Now table-stakes, not a differentiator.
- Internationalisation (~90 UI languages).
- Portable build; no admin required.
- **Limited** autocompletion only — **no** IntelliSense/LSP, no debugging. Deliberately an editor, not an IDE.

## Known limitations (the openings)

1. **Windows-only, by design.** The maintainer explicitly rejected a cross-platform toolkit (wxWidgets). This is the single biggest greenfield opportunity.
2. **~2 GB hard file cap** (an `INT_MAX` check in `buffer.cpp`) even on 64-bit, with severe slowdown well below it and ~4× file-size RAM use (RAM figure unverified). _Sources ~2018-2020; not re-confirmed against a 2026 build._
3. **No IDE features** (debugging, IntelliSense, LSP). A scope choice.
4. **Config UX friction** — confusing options, poor defaults, settings that appear to reset.
5. **Session loss on hard crash** unless session-snapshot was pre-enabled.
6. **No cloud/collaboration** (lower priority; arguably off-mission).

## Governance / trust context (matters for positioning)

Notepad++ has a long history of **political-statement release names and Easter eggs** by its maintainer (Tiananmen, Free Uyghur, Stand with Hong Kong, Boycott Beijing, etc.), which has repeatedly drawn DDoS, GitHub brigading and regional blocking. More seriously, a **2025 update-channel compromise** (suspected APT31) redirected East-Asian users' updates to malicious servers for months before being fixed (and the v8.8.7 move to signed binaries fits that hardening). The install base is real, but a single-maintainer update channel carrying editorial content is a liability for corporate users — a credible wedge for a **neutral, signed, verifiable, no-surprises** alternative.

## Flags (verify before relying on these externally)

- Active-contributor count / true bus-factor (repo shows ~29.6k★, ~2.9k open issues, but contributor count not quantified).
- Scintilla's exact current licence text (permissive, not re-verified this run).
- Whether a 2025-2026 release lifted the ~2 GB cap.
- No telemetry controversy found — "not found" ≠ "confirmed none".

_Sources: official downloads page, Wikipedia (Notepad++), github.com/notepad-plus-plus, Notepad++ community forum, HN, G2/GetApp; harvested 2026-10-18. Full citations in `01-user-research.md`._
