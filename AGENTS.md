# Working in this repo (humans and agents)

A concise "where to look" + working boundaries file. Authoritative detail lives in the linked docs, not here.

## Where to look
| You want | Read |
|---|---|
| What we're building & why | `README.md`, `docs/04-product-scope.md` |
| What Notepad++ is today (baseline) | `docs/00-current-state-notepadpp.md` |
| What users want | `docs/01-user-research.md` |
| The competitive field & the gap | `docs/02-competitive-landscape.md` |
| How we work / CI / checks | `docs/03-engineering-practices.md`, `justfile`, `scripts/` |
| Decisions on the record | `docs/decisions/` |
| The app itself | `app/` (Tauri: `app/src` web UI, `app/src-tauri` Rust) |

## Working boundaries
- Stay in the PR's stated scope; put anything else in the tracker.
- Delete replaced code — no commented-out blocks, no `old`/`new`/`copy` files.
- Update docs in the **same** PR as the change they describe.
- No `TODO`/`FIXME`/`HACK` in the tree (CI fails) — raise a tracker item instead.
- Run `just check` before pushing; CI runs the same thing and is the real gate.

## Protected principles (from `docs/04-product-scope.md`)
- Instant open is a feature — **no blocking I/O on the UI thread.**
- Simple by default; depth is opt-in.
- Cross-platform from commit #1 (Windows/macOS/Linux as peers).
- Local plain files, no lock-in.

## Style
- British English. No emojis in code or docs. Conventional Commits for messages.

## Attribution policy
**Decided 2026-10-19: strip per-commit AI trailers; disclose AI assistance once.** No
`Co-Authored-By: Claude` / `Generated with Claude Code` lines in commit messages or PRs.
Enforced mechanically: the `.githooks/commit-msg` hook rejects them at commit time
(installed by `just setup`), and CI re-scans each PR/push's new commits
(`scripts/check/ci-no-ai-trailers.sh`). The single disclosure lives in `README.md`.

> tuhi is built by Vernon Kay with heavy use of AI assistance (Claude Code). The code,
> decisions and responsibility are the author's; the AI is a tool, disclosed here rather
> than credited per commit.
