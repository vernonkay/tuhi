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

## 0.2 — Markdown mode (next headline)

- Hybrid live Markdown preview (Typora-style, no vault required): Mermaid, KaTeX,
  tables, code highlighting; source always available.
- Export via Pandoc (PDF / DOCX / HTML).
- Optional `[[wikilinks]]` (available, never an imposed vault).

## Planned / under consideration

- **Viewport (incremental) highlighting** so files above the current ~2 MB cap colour
  as you scroll, and tree-sitter-based highlighting.
- **Editable multi-GB files** (a piece-tree engine); today files 25 MB and up open
  read-only.
- **A smarter outline for very large documents** — summarise/bucket huge flat heading
  lists instead of listing every one.
- Modern multi-cursor, find-in-files, show-unprintable-characters.
- Crash-safe persistence of unsaved buffers.
- Signed / notarised builds once there's traction (0.1.0 ships unsigned).
