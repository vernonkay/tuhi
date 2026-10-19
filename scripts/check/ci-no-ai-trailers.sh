#!/usr/bin/env bash
# Purpose: CI backstop for the attribution policy — fail if any NEW commit carries an
#          AI co-author / "Generated with Claude Code" trailer. The commit-msg hook
#          (.githooks/commit-msg) is the primary control; this re-scans the event's
#          commit range in case a commit was made with hooks skipped. It scans ONLY new
#          commits, never full history (the earliest commits predate the policy).
# Usage:   BASE_REF=<branch> or BEFORE_SHA=<sha> bash scripts/check/ci-no-ai-trailers.sh
# Note:    deliberately named ci-* (not check-*) so run-checks.sh does not auto-run it;
#          it needs a commit range and is called explicitly from CI.
set -uo pipefail
cd "$(dirname "$0")/../.."

range=""
if [ -n "${BASE_REF:-}" ]; then
    git fetch --quiet origin "$BASE_REF" 2>/dev/null || true
    range="origin/${BASE_REF}..HEAD"
elif [ -n "${BEFORE_SHA:-}" ] && [ "${BEFORE_SHA}" != "0000000000000000000000000000000000000000" ]; then
    range="${BEFORE_SHA}..HEAD"
fi

if [ -z "$range" ]; then
    echo "ci-no-ai-trailers: no commit range provided; skipping (set BASE_REF or BEFORE_SHA)"
    exit 0
fi

if git log "$range" --format='%B' 2>/dev/null \
    | grep -qiE 'Co-Authored-By:[[:space:]].*(Claude|Anthropic|Copilot|GPT|Gemini)|Generated with \[?Claude Code'; then
    echo "x AI attribution trailer found in a commit in ${range}."
    echo "  tuhi strips these (policy: disclose once in README/AGENTS.md). Amend the offending commit(s)."
    exit 1
fi
echo "ok: no AI attribution trailers in ${range}"
exit 0
