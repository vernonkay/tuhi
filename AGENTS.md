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
TBD (open decision — see `docs/04-product-scope.md`). Once set, it is enforced mechanically via a commit-msg hook + a CI re-scan, the same way dt-platform enforces its own (opposite) policy.
