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
5. **Signed / notarised builds** — remove the SmartScreen/Gatekeeper friction for a public
   1.0 (0.1.x ships unsigned).
6. **UI design pass** — tidy the existing design (which is good but has rough edges) to a
   polished, Obsidian-quality feel.

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
- Modern multi-cursor, find-in-files, show-unprintable-characters.
- Signed / notarised builds once there's traction (0.1.0 ships unsigned).
