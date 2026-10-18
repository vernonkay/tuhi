# Tuhi, backlog

A plain task list for the project (local, not wired to any tracker).

## Now
- [ ] Front-end: virtualised viewport renderer that calls `get_viewport` (render only visible lines; scrolling loads more).
- [ ] Wire open/save through a Tauri file dialog + the editor commands; show `DocumentMeta` (path, line/char count, dirty) in a status bar.
- [ ] Rename the Cargo crate `app` to `tuhi` (package + lib `app_lib`->`tuhi_lib`, update `main.rs`), rebuild to verify.

## Next
- [ ] tree-sitter syntax highlighting in the Rust core.
- [ ] Tabs: a document registry keyed by id (multi-document).
- [ ] Find/replace with regex + dry-run/preview for Find-in-Files.
- [ ] Markdown mode: hybrid live preview (Mermaid, KaTeX, tables), Pandoc export.
- [ ] Large-file mode: memory-mapped open + confirm multi-GB scroll.

## Research / mine (reusable Rust from DataTorque HEKE)
- [ ] Dive into HEKE's **Rust** repos on GHE and extract reusable, *generic* Rust patterns and tooling for Tuhi. HEKE is mixed (36 TypeScript, **15 Rust**, 7 Go); the Rust is the backend core: `rms-financial`, `rms-identity`, `rms-aggregator`, `rms-migration`, and the standalone demo APIs `rms-payments-demo-api` and `rms-returns-demo-api` (axum/sqlx). Targets: workspace/crate layout, error handling, CI, clippy/lint config, test patterns, useful crate choices, dev tooling.
  - **IP guardrail (important):** HEKE is DataTorque proprietary (`rms-financial` is described as "the core module of the DataTorque RMS platform"). Borrow generic *patterns and discipline*, **not** proprietary domain code. Copying any HEKE source into this personal, soon-public OSS repo is an explicit IP decision for Vernon, not a default, and some HEKE code may touch client or third-party material. Same rule we used for `dt-platform`: practice, not code.

## Foundations / housekeeping
- [ ] Add canonical `LICENSE-MIT` + `LICENSE-APACHE` texts.
- [ ] Decide: keep or strip AI co-author commit trailers; record the attribution policy in `AGENTS.md`.
- [ ] Decide the GitHub home (`dt-vernonk` vs a separate personal account), then create the remote as "Tuhi".
- [ ] CI: confirm the workflow runs `just check` green on a PR.
- [ ] Brand: finalise the logo (outline the wordmark to paths), app icons/favicon, light + dark marks.

## Done
- [x] Repo scaffolded (Tauri, React/TS).
- [x] Research + base scope (docs/00-04).
- [x] Engineering baseline from dt-platform (justfile, CI, checks, PR template, AGENTS.md).
- [x] ADR-0001 Tauri; ADR-0002 editing core = Rust rope (Option B).
- [x] Rope core (`ropey`) with open/viewport/insert/delete/save commands + tests; compiles, tests green.
- [x] Named the project Tuhi; set app identity; brand v1 (concept + draft logo).
