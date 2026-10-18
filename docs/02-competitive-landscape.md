# Competitive landscape & the gap

_Research run 2026-10-18. Items resting on pre-run background knowledge are marked [bg]; unconfirmed items [unverified]._

## A. Editors / Notepad++ alternatives

| Product | Stack | License | Cross-platform | Does better than N++ | Weakness |
|---|---|---|---|---|---|
| **NotepadNext** | Qt6/C++, reuses Scintilla/Lexilla | GPLv3 | Win/macOS/Linux | It's cross-platform — the one thing N++ never was | **The key prior art.** ~14k★, v0.13 (Jan 2026), single maintainer; README still says "not safe for critically important work". Demand proven, execution unfinished. |
| **Win11 Notepad** | WinUI/WinAppSDK [bg] | Proprietary | Windows only | MS's own admission the category should grow up: tabs, autosave, dark mode, AI (Rewrite/Summarize/Write), light Markdown | Windows-only; AI gated behind M365/Copilot; backlash at AI creeping into a minimal tool |
| **VS Code** | Electron + Monaco [bg] | MIT core / proprietary binaries | Win/macOS/Linux | Deepest extension + LSP ecosystem | The reference point for "Electron bloat"; overkill as a notepad |
| **Zed** | Rust + GPUI (GPU, not Electron) | GPLv3 editor | Win/macOS/Linux; 1.0 Apr 2026 | Raw render/typing speed, modern collab + AI | Mac-heritage, dev/IDE-positioned, not a "simple notepad"; Win/Linux maturity trails. **Most dangerous competitor for "fast native OSS".** |
| **Sublime Text 4** | C++ + custom GPU renderer | Proprietary, ~US$99 | Win/macOS/Linux | Cross-platform AND genuinely fast + polished | Closed-source & paid — why the OSS crowd never fully left N++ |
| **Lapce** | Pure Rust, Floem + wgpu | Apache-2.0 [bg] | Win/macOS/Linux | Modern Rust/GPU + sandboxed WASM plugins | Beta stability, small ecosystem |
| **CudaText** | Lazarus/Free Pascal + Python addons | OSS (MPL/LGPL-ish) [bg] | Widest (incl. BSD/Haiku) | Broadest OS coverage, native & light | Niche, small community, dated UI, Pascal limits contributors |
| **micro / Helix** | Go / Rust, terminal | MIT / MPL-2.0 | Cross-platform (TUI) | Zero-install terminal editing; Helix = modal + built-in LSP | Terminal-only; Helix modal curve is the opposite of "usable by many" |

**Electron vs native:** Electron = VS Code (+ most Markdown apps). Native/GPU = Zed, Lapce, Sublime, CudaText, NotepadNext, Notepad++. The consistent narrative: Electron wins ecosystem, loses on RAM/cold-start; natives win footprint, trail on ecosystem/polish (Zed excepted).

## B. The Markdown angle — the bar for "doing Markdown well"

Feature bar from the leaders: (1) hybrid/live preview or inline WYSIWYG; (2) math (KaTeX); (3) diagrams (Mermaid); (4) assisted tables; (5) wikilinks + backlinks; (6) Pandoc export to PDF/DOCX/HTML; (7) local plain `.md` files; (8) code-block highlighting; (9) citations/footnotes.

| Product | Stack | License | Paradigm | Note |
|---|---|---|---|---|
| Obsidian | Electron + CodeMirror 6 | Proprietary freemium | Knowledge base (vault/graph) | PKM standard; heavier than "an editor" |
| Typora | Electron + CodeMirror [bg/unverified] | Paid ~US$15 | Pure editor | The benchmark for seamless WYSIWYG; closed, no plugins |
| Mark Text | Electron (Vue) | MIT | Pure editor | OSS answer to Typora, but **maintenance-unstable** (dormant 2024→, revival [unverified]) |
| Zettlr | Electron + CodeMirror | GPLv3 | Academic | Zotero citations + Pandoc; Electron footprint |
| Logseq | ClojureScript + Electron | AGPL [bg] | Outliner | Multi-year DB-rewrite "development hell"; acquired-taste paradigm |
| iA Writer | Native per-OS [bg] | Paid | Prose | Beautiful, deliberately minimal, no plugins/diagrams |
| VS Code MD | Electron/Monaco | MIT | Source+preview | Where devs already edit `.md`; no inline WYSIWYG |

**The telling fact:** every OSS Markdown editor here is Electron or stalled. **There is no fast, native, actively-maintained, open-source Markdown editor with hybrid WYSIWYG.**

## C. The gap / the wedge

**Don't fight where it's crowded:** general IDE (VS Code/Zed own it), PKM note-graphs (Obsidian/Logseq), terminal/modal (Helix/vim), single-platform clean WYSIWYG (Typora/iA), and **AI features** — Microsoft is giving Rewrite/Summarize/Write away in the OS; treat AI as an optional local plugin, never the headline.

**The unoccupied square** is the intersection of all five: _fast, native (non-Electron), truly cross-platform, open-source & free, simple-by-default-yet-extensible general text editor that also treats Markdown as a first-class mode with hybrid live preview._ No single product scores on all five. NotepadNext proves the demand (14k★) and proves it's unmet (can't ship a stable 1.0).

**Defensible differentiators** (architecture/licence locks incumbents out):
1. Non-Electron performance + true cross-platform + OSS, **together** — each incumbent is structurally barred from one leg.
2. "Notepad-simple by default, power-tool on demand" — explicitly reject the modal (Helix) and vault (Obsidian) paradigms.
3. First-class Markdown **mode** (Typora-quality hybrid preview, Mermaid/math/Pandoc) on local files, **without** forcing a knowledge-base.
4. A credible Notepad++ **migration/compat** story (familiar shortcuts, session behaviour, ideally a plugin-heritage path) — inherits a userbase no greenfield editor has.

**Nice-but-not-defensible:** AI rewrite/summarise; another theme engine; a plugin API with no ecosystem; raw speed alone; a bare "cross-platform Notepad++ clone" (NotepadNext exists — the bar is execution, not concept).

**Sharpest framing:** the product collapses **two apps most people split** — the fast simple cross-platform scratch/code editor (Notepad++/Sublime) **and** a clean local-Markdown writing surface (Typora) — delivered native-fast and open-source, which nothing currently is simultaneously. Two external risks: **Zed** maturing on Win/Linux (mitigate by owning *simplicity* + *Markdown writing*, which Zed de-prioritises) and **Win11 Notepad** absorbing casual Windows users (mitigate with cross-platform + OSS + depth + no subscription).

**Build-vs-fork decision point:** NotepadNext is either the foundation to adopt and properly resource, or the cautionary tale — its existence means the concept is validated and the remaining work is execution + stability + the Markdown layer, not invention. (Open question in `04-product-scope.md`.)

_Sources: ubuntuhandbook.org, github.com/dail8859/NotepadNext, phoronix/linuxiac (Zed 1.0), windowslatest/techradar (Win11 Notepad), Wikipedia (Sublime Text), altlinux (Lapce), itsfoss (CudaText), github.com/helix-editor, forum.obsidian.md, rywalker.com (Typora), lwn.net (Zettlr), discuss.logseq.com — harvested 2026-10-18._
