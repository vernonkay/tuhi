#!/usr/bin/env bash
# Purpose: fail if TODO/FIXME/HACK/XXX markers are left in source — raise a ticket instead.
# Usage:   bash scripts/check/check-no-todos.sh
# Exit:    0 = none found; 1 = markers found (listed).
set -uo pipefail
cd "$(dirname "$0")/../.."

# Whole-word markers only (so "DEBUG" etc. don't false-match). Source dirs only.
if git grep -nE '\b(TODO|FIXME|HACK|XXX)\b' -- 'app/src' 'app/src-tauri/src' 'scripts' 2>/dev/null; then
    echo "✗ Found TODO/FIXME/HACK/XXX above. Raise a tracker item and remove the marker."
    exit 1
fi
echo "✓ no TODO/FIXME/HACK/XXX markers"
exit 0
