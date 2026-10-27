#!/usr/bin/env bash
# Purpose: the end-of-phase gate. Run every check, the Rust tests, the front-end UI tests, then
#          build the release bundle — one command to confirm a build phase is sound without
#          manual clicking. Run it after finishing each phase of the editor roadmap.
# Usage:   bash scripts/verify.sh   (or: just verify)
# Exit:    0 = checks + tests + build all passed; non-zero = something failed (see output).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "━━ 1/4  checks (fmt · clippy · tsc · supply-chain)"
bash scripts/check/run-checks.sh

echo "━━ 2/4  Rust tests"
( cd app/src-tauri && cargo test )

echo "━━ 3/4  front-end UI tests (Vitest + Testing Library, headless)"
( cd app && npm test )

echo "━━ 4/4  release build (bundles the installer)"
( cd app && npm run tauri build )

echo "✓ verify passed — this phase's build is sound"
