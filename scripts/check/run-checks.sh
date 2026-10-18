#!/usr/bin/env bash
# Purpose: run every check in scripts/check/ and report all failures (not just the first).
# Usage:   bash scripts/check/run-checks.sh   (or: just check)
# Exit:    0 = all passed; 1 = one or more checks failed.
set -uo pipefail
cd "$(dirname "$0")/../.."

fail=0
run() {
    echo "── $1"
    if ! bash "$1"; then
        echo "   ✗ FAILED: $1"
        fail=1
    fi
}

# Project-specific checks (keep each tiny and single-purpose)
for c in scripts/check/check-*.sh; do
    [ "$c" = "scripts/check/check-*.sh" ] && continue
    run "$c"
done

# Formatter + lint as CHECKS (fail, never auto-fix — devs run `just fmt` locally)
echo "── rustfmt --check"
( cd app/src-tauri && cargo fmt --check ) || { echo "   ✗ run 'just fmt'"; fail=1; }
echo "── clippy -D warnings"
( cd app/src-tauri && cargo clippy --all-targets -- -D warnings ) || fail=1
echo "── tsc --noEmit"
( cd app && npx tsc --noEmit ) || fail=1

[ "$fail" -eq 0 ] && echo "All checks passed." || echo "Some checks failed."
exit "$fail"
