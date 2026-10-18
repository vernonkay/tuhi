# Engineering practices — adopted from DataTorque's dt-platform

_Source: a read of `Product/dt-platform` (Lowell Meyer & team's engineering tooling), 2026-10-18. The app we're building is completely different (a Rust/Tauri desktop editor vs a Go+TS web platform), so this separates the transferable **discipline** from the **mechanism**. "Best practice is best practice."_

## Carry directly (stack-independent)

1. **One task-runner as the single entry point, with zero logic in it.** dt-platform's `justfile` defines every command (`setup`, `run`, `test`, `check`, `generate`) and a check even *fails the build* if a recipe contains inline logic — logic lives in version-controlled scripts under `scripts/`. One discoverable surface (`just --list`), identical locally and in CI. → We'll use `just` (Rust-friendly, we already lean Rust).
2. **Same checks run locally AND in CI; CI is the real gate.** Local git hooks give fast feedback but are skippable (`--no-verify`), so CI re-runs the identical suite. Design principle, not duplication.
3. **Block direct pushes to `main` in a pre-push hook** — cheap, local, prevents the common mistake before the server.
4. **Many tiny, single-purpose, self-documenting check scripts**, each with a Purpose/Usage/Exit-codes banner and an actionable failure message, wired into one `check` target. Even the check-naming convention is itself enforced.
5. **No `TODO`/`FIXME`/`HACK` left in the tree** — a check fails the build; incomplete work goes to the tracker, not into rotting comments.
6. **Documentation-location discipline** — docs confined to known folders so they don't sprawl.
7. **PR template that forces scope thinking:** Intent / In scope / **Out of scope** / **Done when** (each named by a test) / related decisions ("every citation must resolve; write 'None' rather than omit"). Stack-agnostic gold.
8. **Formatters run as a CI *check* (`--check`/`--diff`, fail don't fix); devs run the fixer locally.** → rustfmt `--check`, Prettier/dprint `--check`, clippy `-D warnings`.
9. **Reproducible pinned toolchain, one-command bootstrap** (`just setup`) that seeds local config from `*.example` without clobbering existing config. Tool versions pinned at point of use; CI actions pinned to commit SHAs.
10. **Generated/derived artifacts are verified in CI, never hand-maintained** — regenerate and `diff` against what's committed; fail on drift. For us that maps to: settings schema → typed accessors, theme/token generation, keybinding tables, i18n bundles, any grammar/parser codegen.
11. **Least-privilege CI** (`permissions: contents: read`, `persist-credentials: false`).
12. **Checks keep running after a failure** so one CI run surfaces every problem, not just the first.
13. **Module boundaries enforced by script, with a "change the rule in the same PR" clause.** The *principle* (machine-checked architecture boundaries, changed consciously) transfers; our layers differ (document model / editor core / UI / plugins / platform adapters).
14. **Contributor instructions as a concise pointer file** (where-to-look table + working boundaries: stay in scope, delete replaced code, no commented-out/`old`/`new` copies, update docs in the same PR) rather than a wall of rules.
15. **Checked-in reviewer config** that mirrors the PR template (review against "Done when", flag out-of-scope, require tests, exclude generated files).

## Keep the idea, swap the mechanism (Go/TS → Rust/Tauri)

- **Commit/PR conventions** — dt-platform uses ticket-prefixed subjects + squash-merge with `(#NNN)`. For a public OSS editor: **Conventional Commits** + squash merges, and we'll need a real **versioning/release scheme** a desktop app requires (semver + release tags + **signed auto-update channel** — note Notepad++'s 2025 update-channel compromise; signing/verification is not optional).
- **Dependency automation** — enable **Renovate/Dependabot** on `cargo` + `npm`.
- **Schema-first / generate-and-diff** — dt-platform uses sqlc for SQL→Go. We have no DB, but the pattern maps to: config/settings JSON-Schema → typed Rust/TS, theme tokens, keybindings, i18n. Keep "one source of truth, generate the rest, CI fails on drift."
- **TS strictness baseline** — reuse dt-platform's `tsconfig.base.json` strict flags almost verbatim for the Tauri web UI; add clippy + `#![warn(...)]` on the Rust side.
- **Curated linter preset + a few domain-specific forbidden-pattern rules.** dt-platform bans `float32/float64` ("floats can't represent money"). Our domain bans would be different but the mechanism is the same — e.g. **forbid blocking I/O / synchronous file writes on the UI thread** (directly relevant to the "instant feel" we must protect).
- **Integration tests use the real dependency in a disposable container, not mocks** — mostly N/A for a local editor, but if we add an LSP/sync/git integration, keep real-dependency integration tests and machine-readable, race-checked test output.

## Not applicable (dt-platform-specific)

The Go backend, Postgres/Keycloak/OIDC, sqlc & SQL pipeline as concrete tools, the web-SPA four-layer frontend structure, Vite dev servers for two browser apps, the Podman/Compose local stack as a required dependency, and the Jira `DP-`/Notion-ADR org process. We substitute our own tracker and a decision log, keeping the *practice* of recording decisions as ADRs.

## First seven things to stand up (recommended order)

1. One no-logic `just` runner, run identically in CI.
2. The `scripts/check/*` pattern — tiny self-documenting single-purpose fail-fast checkers behind one `check` target.
3. Pre-push hook (block `main` + run checks); CI as the real gate.
4. PR template with explicit Out-of-scope + testable "Done when".
5. Generate-and-diff-in-CI for every derived artifact (settings schema, themes, keybindings, i18n).
6. Pinned toolchain + one-command bootstrap with non-destructive config seeding.
7. No-TODO-in-tree + docs-location checks.

_Note: dt-platform also runs a `commit-msg` hook that **bans** AI co-author trailers (contributions owned by the committing human) and re-scans the whole PR range in CI. That's their deliberate policy and is the opposite of some defaults — for this OSS project we set our own attribution policy explicitly, then enforce it the same mechanical way._
