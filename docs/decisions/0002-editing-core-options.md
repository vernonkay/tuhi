# ADR 0002 (Proposed) — The editing core

- Status: **Accepted — Option B (Rust rope engine), chosen by Vernon 2026-10-18.** This is the call that most shapes the project.
- Date: 2026-10-18

## Why this is the pivotal decision

The "editing core" is the text engine underneath everything: how text is stored and edited, how fast it is, how big a file it can open, how syntax highlighting works, and how hard Markdown-WYSIWYG and multi-cursor are to build. Our three differentiators all run through it: **cross-platform**, **large-file capability** (the ~2 GB Notepad++ cliff is the headline fix), and **first-class Markdown with live preview**. Pick wrong and one of those three becomes very hard.

Tauri is already decided (ADR-0001): a **Rust backend** + a **web-view UI**. The question is what plays the role of the editor *inside* that model.

## The three options

### Option A — A web-native editor in the web-view (CodeMirror 6, or Monaco)

**What it is:** embed a mature JavaScript editor component in the Tauri web-view. CodeMirror 6 (CM6) is the modern, modular one (powers Obsidian and Zettlr); Monaco is VS Code's editor (more features out of the box, much heavier).

- **Fit with Tauri:** native — the UI is already a web-view. Easiest possible integration.
- **Large files:** the weak point. The whole document lives in JavaScript memory; CM6 renders only the visible viewport so it copes with *large* docs (tens–low-hundreds of MB), but **multi-GB is not realistic** without streaming tricks. Monaco is worse on huge files. This is where our headline differentiator fights the stack.
- **Markdown hybrid preview:** the strong point. CM6 is *the* tool people build Typora-style inline/WYSIWYG Markdown on (Obsidian is the proof). Big head-start on our second job.
- **Multi-cursor / column edit:** built in (CM6).
- **Syntax highlighting:** CM6 uses its own Lezer grammars; a decent library exists, though narrower than tree-sitter or Scintilla's 78 languages.
- **Effort:** lowest — a working, good editor in days, not months.
- **Contributor pool (matters for "used by many" OSS):** largest — web developers.
- **Precedent:** Obsidian, Zettlr, VS Code (Monaco), most Electron editors.
- **Risk:** the large-file ceiling is structural, and "instant feel" on giant files depends on JS/web-view performance.

### Option B — A Rust text engine (rope) + virtualised rendering

**What it is:** the text buffer lives in **Rust**, using a *rope* data structure (the `ropey` crate) that makes edits and huge files cheap (O(log n), memory-efficient, memory-mappable). The web-view only ever receives and renders the **visible viewport** (the lines on screen); keystrokes and commands go down to the Rust core. Syntax highlighting via **tree-sitter** (incremental, modern) in the core.

- **Fit with Tauri:** this is Tauri used to its full potential — real work in Rust, thin UI. It's the architecture Zed, Lapce and Helix use (core/UI split; Helix uses `ropey`).
- **Large files:** **best by far.** Rope + memory-mapping + viewport rendering = open and scroll a multi-GB log instantly. This *is* the differentiator, delivered properly.
- **Markdown hybrid preview:** harder — you own the rendering, so Typora-style WYSIWYG is real work (no CM6 to lean on).
- **Multi-cursor / column edit:** full control, but you implement it.
- **Effort:** highest — you are building an editor engine, and the Rust↔web-view viewport protocol is the fiddly part (keeping it low-latency over Tauri's IPC — fine for viewport-sized payloads, but it's the thing to get right).
- **Contributor pool:** Rust developers — smaller, but passionate and exactly the crowd a native OSS editor attracts.
- **Precedent:** Lapce, Zed, Helix. **Cautionary tale:** Google's Xi-editor pioneered this exact rope+async+frontend-protocol design and was abandoned, partly because the architecture got too complex — a real warning for a solo project.
- **Risk:** largest build; easiest to over-engineer; longest road to "it works".

### Option C — Reuse Scintilla (+ Lexilla), as Notepad++ and NotepadNext do

**What it is:** reuse the mature C++ editing component Notepad++ itself is built on — battle-tested, 78-language lexers, folding, decent large-file handling.

- **Fit with Tauri:** **poor, and this is decisive.** Scintilla is a *native UI widget* (Win32/GTK/Cocoa/Qt). It does not live inside a web-view. To use it you'd essentially abandon the Tauri web-view UI for a native toolkit — which is exactly why NotepadNext is **Qt/C++**, not Tauri. Choosing C really means **reopening ADR-0001** (Tauri → Qt).
- **Large files:** good (better than web, not as good as a modern rope+mmap).
- **Markdown hybrid:** not its job — you'd bolt a separate preview on; no WYSIWYG.
- **Effort:** medium to integrate, but you fight the chosen stack the whole way.
- **Contributor pool:** C++ — smallest and least enthusiastic for a new project.
- **Precedent:** Notepad++, NotepadNext, SciTE.
- **Risk:** architectural mismatch with Tauri; "modern UI" and "Markdown WYSIWYG" both become uphill.

## Side-by-side

| | A — Web (CM6) | B — Rust rope | C — Scintilla |
|---|---|---|---|
| Fits Tauri | ★★★ | ★★★ | ✗ (implies Qt) |
| Large files (our differentiator) | ★ | ★★★ | ★★ |
| Markdown WYSIWYG (our 2nd job) | ★★★ | ★★ (DIY) | ★ |
| Cross-platform | ★★★ | ★★★ | ★★ |
| Effort to first working editor | ★★★ (days) | ★ (months) | ★★ |
| Contributor pool | web (largest) | Rust | C++ (smallest) |
| "Challenge/learn" value | low | **high** | low |

## Recommendation

Two honest paths, depending on what you want from this:

1. **Ship-fast-and-learn (default): start with CM6, keep a clean buffer boundary, add a Rust large-file mode later.** Build the MVP on CodeMirror 6 — a good cross-platform editor with excellent Markdown hybrid preview in days, proving the whole thesis quickly. Hide the text buffer behind a narrow interface so that the **large-file "open a 5 GB log" capability** can later be a dedicated mode backed by a Rust `ropey` core, rather than something CM6 has to do. You get a real product sooner, learn Tauri/Rust incrementally, and still reach the differentiator deliberately in a v2.

2. **Build-the-engine (the challenge): go straight to Option B.** If the point is as much to *build something hard and learn Rust properly* as to ship — and your framing ("challenge ourselves") leans this way — then the rope core is the more satisfying and more defensible route, at the cost of a much longer road to "it runs". Mitigate the Xi cautionary tale by keeping the viewport protocol dead simple and resisting async cleverness.

**My lean:** path 1 for momentum, because a personal project lives or dies on seeing it work early — but with Option B explicitly scheduled as the large-file engine, not quietly dropped. Option C only if you'd rather have Scintilla's maturity and are willing to swap Tauri for Qt.

Regardless of A/B: use **tree-sitter** for syntax highlighting (modern, incremental; CM6 can use it too) so that investment carries across if we later move the buffer to Rust.

## Decision (2026-10-18): Option B — the Rust rope engine

The text buffer lives in Rust (`ropey`), the Tauri web-view renders only the visible viewport, syntax highlighting will be tree-sitter. Chosen deliberately over the faster Option A because this is Vernon's first open-source project and the point is as much to build something hard and real as to ship: the rope core is what makes the large-file differentiator (no ~2 GB cliff) genuine, and it's the architecture a native OSS editor deserves. Keeps Tauri (ADR-0001 stands).

## The Xi-editor cautionary tale, and how we avoid it

Google's Xi-editor (Raph Levien, ~2016; "retrospective" June 2020, then archived) pioneered this exact rope + core/front-end-split design and never became a usable editor. The rope was **not** the problem — it was sound and influential (ropey, Zed, Lapce, Helix all descend from it). Two things sank Xi: (1) **async-everything + CRDT** made simple operations hard for little single-user benefit, and (2) **front-end sprawl** across many GUIs fragmented the effort. 

Our guardrails, therefore:
- **Simple, mostly-synchronous viewport protocol** between Rust and the web-view. No CRDT. No async cleverness until something concrete demands it.
- **No collaboration/plugins-out-of-process** in the core design now.
- **Exactly one front-end** (the Tauri web-view).
- **Resist premature generality** — single document first, tabs second.

## Immediate build steps
1. ✅ `ropey` rope core in `app/src-tauri/src/editor/` with open/viewport/insert/delete/save commands + unit tests.
2. Front-end: a virtualised viewport renderer that calls `get_viewport` and renders only visible lines.
3. tree-sitter highlighting in the core.
4. Then: tabs (a document registry), find/replace, Markdown mode.
