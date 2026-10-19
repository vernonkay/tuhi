#!/usr/bin/env bash
# Purpose: fail if TODO/FIXME/HACK/XXX markers are left in source — raise a ticket instead.
# Usage:   bash scripts/check/check-no-todos.sh
# Exit:    0 = none found; 1 = markers found (listed) or a target dir is missing.
set -uo pipefail
cd "$(dirname "$0")/../.."

# Assert the target dirs exist first. git grep on a missing pathspec exits non-zero,
# which would otherwise read as "no markers found" and let this check go green over
# code it never scanned (e.g. after a directory rename).
targets=(app/src app/src-tauri/src scripts)
missing=0
for d in "${targets[@]}"; do
    [ -d "$d" ] || { echo "x check-no-todos: target dir missing: $d (update this script after a move)"; missing=1; }
done
[ "$missing" -eq 0 ] || exit 1

# Whole-word markers only. Exclude this checker itself, which necessarily names them.
if git grep -nE '\b(TODO|FIXME|HACK|XXX)\b' -- "${targets[@]}" ':!scripts/check/check-no-todos.sh'; then
    echo "x Found TODO/FIXME/HACK/XXX above. Raise a tracker item and remove the marker."
    exit 1
fi
echo "ok: no TODO/FIXME/HACK/XXX markers"
exit 0
