# ADR 0004 — Architectural guardrails from the Xi-editor retrospective

- Status: **Accepted, 2026-10-20.** Standing constraints on tuhi's architecture, plus one backlog-hygiene rule.
- Date: 2026-10-20

## Context

ADR-0002 chose a Rust editing core with the web-view rendering only the viewport, and already flagged Google's Xi-editor as the cautionary tale for exactly this design. This ADR formalises that warning into standing constraints, after a close reading of Raph Levien's own **"xi-editor retrospective"** (27 June 2020, https://raphlinus.github.io/xi/2020/06/27/xi-retrospective.html).

Xi pioneered the rope + Rust-core + front-end-protocol design and never became a usable editor. Levien's own verdict: *"To a large extent the project was optimized for learning rather than shipping."* The rope itself was sound — ropey, Zed, Lapce and Helix all descend from that lineage — so what sank Xi was the architecture around it. tuhi deliberately makes the opposite bets, and these guardrails keep it that way.

## The guardrails

### 1. The synchronous core ↔ web-view boundary is the thesis. Defend it.

Xi's single biggest regret: *"adding async made everything more complicated, in some cases considerably so,"* and *"the process separation between front-end and core was not a good idea."* Ordinary features like word-wrap and scrolling became hard because state straddled an async boundary.

tuhi's Rust-core ↔ web-view protocol is synchronous request/response. Async is permitted only at the I/O edges (reading and writing a file), never in the edit model or the viewport protocol. Any proposal to make a feature async must clear the bar Xi failed: it has to buy more than the complexity it adds, for a concrete reason, not a speculative one.

### 2. No CRDT. Single-writer undo/redo.

Xi modelled edits as a CRDT to enable collaboration that *"absolutely failed to materialize,"* and it broke plain features: indentation is history-dependent and *"basically doesn't fit nicely in the CRDT model at all."*

tuhi is a single-user, local editor (see [`VISION.md`](../../VISION.md)). Undo/redo is a plain history stack. CRDT is reconsidered only if real-time multi-user collaboration ever becomes a committed product goal, never speculatively.

### 3. A readable monolith beats an elegant multi-process architecture.

*"In xi, far too often things were blocking on some major architectural re-work,"* which starved contributors of agency; Levien concluded *"monolithic architectures, perhaps ironically, are better for community."*

tuhi is one process with one front-end. The core is optimised for "a contributor can land a feature without re-architecting." No process-per-plugin, no second front-end.

### 4. Don't build a GUI or text-rendering toolkit. Tauri is the anti-yak-shave.

Xi's fatal scope creep was writing an entire new Rust GUI toolkit, which Levien admits *"people would have rightly ridiculed ... as far too ambitious."*

tuhi gets text rendering, layout and cross-platform windowing from the web-view + Tauri for free. No custom GPU text renderer or toolkit unless the large-file story provably demands it, and it does not today.

## Backlog-hygiene rule (process)

Levien: *"One thing I would do differently is more clearly identify which parts are research."* Xi bet on speculative subprojects without separating them from routine work, so research quietly blocked shipping.

So: any speculative roadmap item is tagged **(research)** with its own explicit exit criteria. A research item may not block a shippable feature; if it does, it is cut or time-boxed.

## Watch-list — things Xi shipped effort into and Levien regrets

Do not build these: CRDT editing; a front-end/core process split; process-per-plugin IPC; any custom GPU text renderer or GUI toolkit.

## What worked in Xi, and we keep

The rope (persistent B-tree buffer) and syntax highlighting kept off the UI thread — Levien's "high point". Both are on tuhi's path already (ADR-0003 for the buffer, the roadmap for off-thread highlighting).

## Relationship to other ADRs

- ADR-0001 — Tauri (the stack these guardrails protect).
- ADR-0002 — the Rust editing core (this ADR extends its Xi section).
- ADR-0003 — the piece-tree-over-mmap buffer (the rope lineage Xi validated).
