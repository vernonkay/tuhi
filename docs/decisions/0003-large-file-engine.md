# ADR 0003 — Large-file engine: piece tree over a memory-mapped original

- Status: **Accepted — Vernon Kay, 2026-10-19.** Supersedes the *buffer implementation* chosen in ADR-0002 (an in-memory `ropey` rope). ADR-0002's higher-level decision (Option B: a Rust editing core with the web-view rendering only a viewport) **stands**; this ADR changes what sits underneath it.
- Date: 2026-10-19

## Context — why revisit ADR-0002

ADR-0002 chose a Rust rope (`ropey`) specifically to deliver the headline differentiator: open a multi-GB file with no ~2 GB Notepad++ cliff. A probe on 2026-10-19 (`C:\Users\vernonk\dev\tuhi-probe`) measured the reality:

| File (1 GB) | Resident memory | Open |
|---|---|---|
| normal (19.5M lines) | 1191 MB | 1.5 s |
| single line, no newlines | 1190 MB | 1.3 s |
| invalid UTF-8 | — | hard error |

`ropey` is **wholly in-memory**: resident memory ≈ **1.16× file size**, flat regardless of line structure, with no memory-mapping (no mmap crate exists in its graph). Extrapolated, a 5 GB file needs **~5.8 GB RAM** — unusable on an 8–16 GB laptop. The "open a 5 GB log" promise, as ADR-0002 framed it ("rope + memory-mapping"), rested on a property `ropey` does not have.

Two honest paths followed (project plan gate 7). Vernon chose to **build a true large-file engine** rather than reframe the promise down to "RAM-bounded" — this is a personal project whose point is as much to build something hard and new as to ship, and the known-to-work path takes the challenge out of it. With one condition: a real, pre-agreed way back if it spirals.

## Decision

Implement the editing buffer as a **piece tree over a memory-mapped original file**, behind a `Buffer` trait.

- **mmap the file read-only.** The original bytes are never copied into the heap; the OS pages them in and out on demand. Resident memory becomes O(edits + index), not O(file).
- **Piece table / piece tree.** The document is a balanced tree of *pieces*, each referencing a span of either (a) the mmap'd original or (b) an in-memory append buffer that holds inserted text. Edits splice pieces; nothing rewrites the original. Each tree node carries subtree **byte and newline counts** so viewport lookup by line or offset is O(log n). (This is the VS Code "piece tree" lineage, and conceptually a rope whose leaves point at mmap'd/append spans rather than owning the text.)
- **Encoding layer.** mmap yields bytes, so the engine owns encoding: detect on open, validate/decode UTF-8 lazily per viewport, and offer a byte/hex fallback for non-text or invalid files. This also fixes today's hard-fail on non-UTF-8 input.
- **Viewport windows in both dimensions** — by (line, count) with a **line-length cap**, or by byte range — so a single huge line is never materialised whole across the Tauri IPC (today's `get_viewport` `.to_string()` hazard).
- **Atomic save** — write to a temp file, fsync, rename over the target, then remap. (You cannot truncate-in-place a file you have mmap'd, so save-to-temp is required, not just good practice.)

## The guardrail that makes "we can always come back" real

The buffer lives behind a narrow trait:

```
trait Buffer {
    fn open(path) -> Result<DocumentMeta>;
    fn viewport(start, count) -> Result<ViewportSlice>;  // offsets included; line-capped
    fn insert(pos, text) -> Result<DocumentMeta>;
    fn delete(range) -> Result<DocumentMeta>;
    fn save(path) -> Result<DocumentMeta>;
}
```

- The existing `ropey` code is refactored into **`RopeBuffer`** and kept — it is the fallback (project-plan gate-7 option (a), the known-good RAM-bounded engine).
- The new engine is **`PieceTreeBuffer`**.
- The Tauri commands depend on the **trait**, not the implementation. Switching the default is a one-line change, so reverting to the shipping-today path is not a rewrite.

## Fallback trigger (pre-agreed, not sunk-cost-driven)

Reviewed at **M2 exit**. Fall back to `RopeBuffer` as the 0.1.0 default (keeping `PieceTreeBuffer` behind a feature flag for a later "huge-file mode") if **either**:
1. the piece tree has not opened **and** scrolled **and** edited a 5 GB file end-to-end through the real Tauri path, within the performance budget, with resident memory staying far below file size; **or**
2. the design is showing the Xi smell — growing async/complexity for little single-user benefit (see below).

This is a decision with a date and a test, so "come back to 1" is a real option, not a vague intention.

## The Xi-editor risk, restated because this path invites it

ADR-0002 already warns that Google's Xi-editor pioneered a Rust rope + core/front-end split and never shipped, sunk by async-everything + CRDT and front-end sprawl. Building a bespoke mmap piece-tree engine solo is precisely the kind of ambition that sank it. Guardrails, hardened:

- **Synchronous viewport protocol. No CRDT. No async cleverness** until something concrete demands it.
- **Exactly one front-end** (the Tauri web-view).
- **Single document before tabs.**
- **The `Buffer` trait boundary** (above) — the specific, new mitigation: the hard engine is isolated and reversible.
- Resist premature generality in the piece tree; a simple balanced tree with byte/newline counts first, cleverness only when measured need appears.

## Consequences

- Longest road to "it runs" of the options; the richest learning; and if it lands, the large-file differentiator is genuinely uncontestable (true beyond-RAM, not RAM-bounded).
- The line-start index costs ~8 bytes per line (≈800 MB for a 100M-line 5 GB file) — bounded, far below file size, and segmentable if it bites; measure it in the benchmark.
- Risk is acknowledged (Xi) and mitigated structurally (trait boundary) and procedurally (the M2 fallback trigger).

## Immediate build steps

1. Define the `Buffer` trait; refactor the current `ropey` code into `RopeBuffer` implementing it; make the Tauri commands depend on the trait. (Valuable regardless of engine — it *is* the fallback mechanism.)
2. Spike `PieceTreeBuffer`: mmap + piece list + a line index; get open + viewport working on a 5 GB file; measure resident memory (must stay ~flat, not ≈file size).
3. Then edits (append buffer + piece splicing), then atomic save + remap, then the encoding layer.
4. Benchmark against the adversarial set (5 GB normal, single-line multi-GB, non-UTF-8) and apply the fallback trigger at M2 exit.
