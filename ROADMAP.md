# Roadmap

tuhi is early. This is the outward-facing plan and it will move as things land. Ideas
and priorities are welcome, open an issue.

## 0.1.0 — first release

The lovable baseline, leading with large files:

- Open and scroll multi-GB files with flat memory (no hard cliff); files 25 MB and up
  use a read-only memory-mapped engine.
- Open / edit / save, tabs, atomic save, encoding detection (UTF-8/BOM, UTF-16,
  Latin-1), undo/redo.
- Large-file verbs: **live filter-to-view**, **follow/tail with pattern highlighters**,
  and **one-key JSON pretty-print**.
- Find & replace (regex), syntax highlighting (files under ~2 MB), a file tree, a
  collapsible outline, a command palette, session restore.
- Cross-platform: Windows, macOS, Linux.

## Next up — Settings v1 (preferences panel)

Top of the queue for the next build. The Settings icon is already in the rail; this wires
it into a lean preferences panel, in the spirit of "every option earns its place":

- Theme override (today it's auto light/dark), font family and size, tab width and
  tabs-vs-spaces.
- Default encoding and line endings, a word-wrap toggle.
- Manage the highlighter rules (today stored only in the web-view's localStorage).

## 0.2 — Markdown mode (next headline)

- Hybrid live Markdown preview (Typora-style, no vault required): Mermaid, KaTeX,
  tables, code highlighting; source always available.
- Export via Pandoc (PDF / DOCX / HTML).
- Optional `[[wikilinks]]` (available, never an imposed vault).

## Toward v1.0 — must-haves

The bar for a 1.0 we'd actively market. Large-file credibility first, then the headline
feature, then hardening and finish. (Target date: TBD.)

1. **Viewport (incremental) highlighting** — colour files above the ~2 MB cap as you
   scroll, computed off the UI thread, so the large-file-first promise holds visually.
2. **Engine-backed search / go-to-line / line counts over multi-GB files** — the big-file
   verbs working at GB scale, not just scrolling.
3. **Markdown live preview** (the 0.2 headline) — Typora-style hybrid, Mermaid/KaTeX/
   tables, Pandoc export.
4. **Crash-safe unsaved buffers + autosave** — never lose work.
5. **Signed / notarised builds + in-app updater** — remove the SmartScreen/Gatekeeper
   friction for a public 1.0 (0.1.x ships unsigned), and do the "new release available"
   updater here too: the Tauri updater needs its own signing key and a release endpoint,
   so it belongs with signing rather than as a separate half-measure (notify → download →
   install, from GitHub releases).
6. **UI design pass** — tidy the existing design (which is good but has rough edges) to a
   polished, Obsidian-quality feel.
7. **Full keyboard command set** — every standard editor shortcut, so a keyboard-first
   user never reaches for the mouse: word-wise movement and selection
   (Ctrl/Ctrl+Shift+arrows), document and page jumps (Ctrl+Home/End, PageUp/Down, with
   Shift to extend), and delete-word (Ctrl+Backspace/Delete).

## v1.0 release prep — the finish line

Not features so much as the things a public 1.0 needs on the day:

- **File-type associations** — register tuhi as a handler for `.md`/`.markdown`/`.txt`/
  `.log` (and friends) in the installer bundle (`fileAssociations`), so "Open with → tuhi"
  works. Modern Windows/macOS won't let an app silently claim *default*, so add a Settings
  "Set as default for these types…" action that opens the OS default-apps UI, plus a
  first-run nudge. Rides with the bundle/installer work (#5).
- **Open-type guard** — don't render a binary file as garbage. Detect binary content
  (NUL bytes / invalid-UTF-8 ratio in the first chunk) and gate it behind an
  "open anyway?" prompt, with a configurable `alwaysText` / `neverOpen` extension list
  on top for overrides. Content detection first, extension list second, so a `.log` or
  an extensionless file still opens and a `.docx` (a ZIP) is caught.
- **A proper README for first run** — what tuhi is and who it's for, install per OS, the
  large-file and Markdown stories up front, the keyboard set, and a screenshot or two.
  It's the first thing a new installer sees.
- **A fresh demo GIF** — the current one predates the Twin-Gutters chrome, the big-file
  verbs and Markdown mode; re-record once the feature set is frozen.
- **A landing page** — a static product page (what tuhi is, the GIF, per-OS download
  links, the GitHub link), built from the README content and brand palette. Host it free
  on **Cloudflare Pages at `tuhi.pages.dev`** for launch; a custom domain (`tuhi.dev` /
  `tuhi.nz`, ~US$10/yr) waits until there's community traction — switching is just a DNS
  change, no rebuild.

## Planned / under consideration

Shaped partly by a study of why Google's Xi-editor was abandoned (see
[`docs/decisions/0004-xi-guardrails.md`](docs/decisions/0004-xi-guardrails.md)).
Speculative items are tagged **(research)** with their own exit criteria, so they can't
quietly block shippable work.

- **Viewport (incremental) highlighting** so files above the current ~2 MB cap colour
  as you scroll (tree-sitter-based), computed **off the UI thread** so highlighting a
  huge file never blocks typing.
- **Editable multi-GB files** (a piece-tree engine) *(research)*; today files 25 MB and
  up open read-only.
- **Engine-backed search/replace, go-to-line and line counts over multi-GB files**,
  using the buffer's tree so none of it has to materialise the whole file.
- **Crash-safe persistence of unsaved buffers**, via cheap copy-on-write buffer
  snapshots (near-free once the buffer is persistent) plus autosave.
- **Correct Unicode editing** — grapheme-cluster cursor movement and column widths.
- **Background file I/O for load and save only**, off the UI thread, with async kept to
  the edges and never the edit model.
- **A smarter outline for very large documents** — summarise/bucket huge flat heading
  lists instead of listing every one.
- **Virtualized Markdown preview** — render only the blocks in view so the live preview
  scales to huge documents and the current ~512 KB preview cap can be lifted (above it a
  Markdown file opens as source today).
- **Background opacity / window translucency** — an optional Settings slider for a
  translucent window. Deferred from 1.0 (legibility and per-OS compositor quirks), but
  the geeks love it, so it's on the list.
- Modern multi-cursor, find-in-files, show-unprintable-characters.
- Signed / notarised builds once there's traction (0.1.0 ships unsigned).
