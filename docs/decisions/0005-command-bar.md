# ADR 0005 — One command bar: Find, Filter, Commands, Go-to-line and Replace share one input

- Status: **Accepted — Vernon Kay, 2026-10-28.** Implements issue #47. Does not supersede an earlier ADR; it consolidates UI that grew up as separate pieces.
- Date: 2026-10-28

## Context

Find, Filter, Commands, Go-to-line and Replace are the same interaction — a single-line input that narrows a set and acts on a choice — but they had grown into four separate overlays (a top `findbar`, a `filter-view` with its own bar, a centred palette modal, a second `findbar` for go-to-line), each with its own gutter dot and its own ad-hoc keyboard handling. Three tells that this had drifted:

- **Format JSON was a gutter dot**: an action with no query, offered even on non-JSON files, where it produced a "not valid JSON" error. An action does not belong in the same row as modes that filter a set.
- **Five dots down the left rail** (Find, Filter, Data, Format JSON, Commands) plus Files and Settings — the rail was becoming a toolbar, not a small set of surfaces.
- **Four Esc branches, four open helpers, two `findbar` blocks**: the same keyboard model re-implemented per overlay, which is how they drifted apart.

## Decision

One top-centre **command bar** with a mode chip and one keyboard model. `cmdMode` (`"command" | "find" | "replace" | "filter" | "goto" | null`) is the single source of truth; the old per-surface booleans (`findOpen`, `filterOpen`, `paletteOpen`) are **derived** from it, so every existing effect and result surface keeps working while only the *input chrome*, the *open mechanism* and the *keyboard model* unify.

| Mode | Opens with | Result surface | Enter |
|---|---|---|---|
| Command | `Ctrl+P`, the Search dot, no prefix | dropdown of commands + files | run |
| Find | `Ctrl+F`, `/` prefix | in-doc highlights + count | next match (Shift+Enter: previous) |
| Replace | `Ctrl+H`, the ⇄ toggle | a second row | Replace all |
| Filter | the Filter command, `=` prefix | editor collapses to matching lines (live) | keep the collapsed view |
| Go to line | `Ctrl+G`, `:` prefix | — | jump |

- **The input is unified; the result surface is not.** Filter still transforms the editor viewport (reusing the data-mode collapse list); Find keeps its in-doc highlights and match navigation; Command drops a list beneath the input. This is deliberate — the modes genuinely differ in *what they show*, only not in *how you drive them*.
- **Prefixes mirror the shortcuts** so muscle memory survives and discovery is cheap: typing `/`, `=` or `:` as the first character in Command mode jumps straight to Find, Filter or Go-to-line.
- **The gutter becomes Files · Search · Data · Settings.** The Find, Filter, Commands and Format JSON dots are gone. Search opens the bar; Data is kept (it is a deliberate recent surface, ADR-adjacent to the lens); Format JSON becomes a **context-gated command**, present in the Command list only when the document sniffs as JSON.

## Consequences

- Three overlays collapse to one; four Esc branches and the separate close helpers collapse to one `closeCmd`; one input ref and one focus effect replace the per-overlay focus calls.
- The data-mode **lens** keeps its own inline filter box. The lens and the command bar's Filter mode share `filterQuery`/`filterMatches` (harmless — they are the same filter), and the collapse surface is shared by both via `renderFilterList`. Unifying the lens *input* into the bar is explicitly out of scope here; the lens is the in-place surface for logs, the bar is the global one.
- Covered by `app/src/App.commandbar.test.tsx` (Vitest + Testing Library, backend mocked): each mode opens from its shortcut, the `/` prefix switches mode, Filter collapses the editor, and the rail shows Files · Search · Data · Settings with the old dots gone.
