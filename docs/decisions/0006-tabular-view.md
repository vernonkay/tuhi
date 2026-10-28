# ADR 0006 — Tabular view: render a delimited file as a virtualized grid over the existing engine

- Status: **Accepted — Vernon Kay, 2026-10-29.** Implements the v1.1 "tuhi opens anything" roadmap item #1 (the roadmap pivot of 27 October 2026). Builds on ADR-0003 (the large-file engine) and ADR-0002 (the buffer trait); supersedes nothing.
- Date: 2026-10-29

## Context

tuhi's real moat is the large-file engine: it opens and scrolls multi-GB files that Notepad++, VS Code and Obsidian stall on. A great deal of what people open at that size is *data* — CSV, TSV, JSON-lines, logs — and viewing a huge CSV as raw text is serviceable but not compelling. Seeing it as a real grid, that you can scroll, sort and jump around, is the headline "wow" for the pivot, and it is a thing none of the alternatives do at this file size.

The constraint is that it must not undermine the engine. Anything that needs the whole file resident, or a second full index, would reintroduce exactly the ceiling the mmap engine removed.

## Decision

A **virtualized grid view** that rides on the existing `Buffer::viewport`. The grid asks the active engine for a window of lines and splits each into cells; nothing new is indexed, so the mmap engine's O(1) random-row access and per-line length caps apply unchanged, and a multi-GB CSV grids the same way it scrolls as text.

| Concern | Decision |
|---|---|
| Record model | **One physical line is one record.** True CSV allows newlines inside quoted fields, which would break line-addressed random access and the mmap newline index; record-aware indexing is deferred. Quoting *within* a line (a delimiter or quote inside `"…"`, with `""` as an escaped quote) is handled, which covers the overwhelming majority of real exports and every TSV/log. |
| Shape detection | `table_sniff` samples the first ~50 lines and picks the delimiter (`,` `\t` `;` `|`) that splits them into the most columns *most consistently*, and guesses a header (first row all non-numeric text over data that isn't). `.csv`/`.tsv`/`.tab` **auto-open** as a grid once the sniff confirms it parses; a non-tabular `.csv` falls back to data mode. A `View as table` / `View as text` command toggles it. |
| Row rendering | **Rows virtualized, columns not.** Only visible rows are DOM nodes, each row window fetched on demand (`table_window`); all columns render per row with horizontal scroll. This suits the common case (tens of columns); wide-table column virtualization is a later refinement. Sticky header row and sticky row-number column. |
| Sort | Click a header to cycle none → ascending → descending. `table_sort` returns a **stable, numeric-aware** order of data-row indices (numbers numerically, text case-insensitively, blanks last), reading the column in batches through the viewport so it works on the large-file engine. It is in-memory, so it **refuses files over a row cap** (`table::MAX_SORT_ROWS`) with a message the grid shows. When a sort is active the grid maps each visible row to its source line through the order and fetches those scattered rows with `table_rows_at`. |
| Jump to column | A toolbar selector scrolls the grid horizontally to a chosen column, for wide tables, alongside a row/column/sort summary. |

## Consequences

- **No new engine work and no new index.** The view is a default trait method (`Buffer::table_rows`) plus four thin commands; both the rope and mmap engines get it for free. The only genuinely new backend logic is cell splitting and sorting, both pure and unit-tested.
- **Known limits, stated on purpose:** no cross-line quoted records (one line = one record), columns are not virtualized (very wide tables render every column per row), and sort is bounded by an in-memory row cap. Each is a clean follow-up (a record-aware index; column virtualization; an external-merge sort) rather than a redesign.
- **Coexists with data mode.** `.csv`/`.tsv` prefer the grid; data mode (filter/tail/highlight) remains one command away for the same file, and logs/large non-delimited files still open in data mode.
- Covered by `app/src-tauri/src/editor/table.rs` unit tests (splitting, sniffing, sort ordering) and `app/src/App.tabular.test.tsx` (auto-open, header, non-tabular fallback, sort indicator, column selector, toggle). The grid's scroll/virtualization behaviour is exercised by the end-to-end harness and reviewed on the real build at the release candidate.
