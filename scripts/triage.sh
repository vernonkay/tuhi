#!/usr/bin/env bash
# tuhi triage helper — respond, label, and close an issue in one command.
#
# GitHub saved replies have no create API (they're a per-account web-UI feature),
# so this script is the automatable equivalent: it posts the right templated reply,
# applies the outcome label, removes needs-triage, and closes where appropriate.
# The wording mirrors TRIAGE.md. Always personalise the first line with --note.
#
# Usage:
#   scripts/triage.sh <issue#> <disposition> [--note "a personal first line"] [--dup <issue#>]
#
# Dispositions: accepted | backlog | needs-info | duplicate | wontfix-scope | wontfix-vision
#
# Examples:
#   scripts/triage.sh 42 accepted --note "Great idea, Sam."
#   scripts/triage.sh 7 duplicate --dup 3
#   scripts/triage.sh 9 wontfix-vision --note "Thanks for the detailed write-up."
set -euo pipefail

BOARD="https://github.com/users/vernonkay/projects/1"

die() { echo "error: $*" >&2; exit 1; }
usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

[ $# -lt 2 ] && usage 1
issue="$1"; disp="$2"; shift 2
note=""; dup=""
while [ $# -gt 0 ]; do
  case "$1" in
    --note) note="${2:-}"; shift 2;;
    --dup)  dup="${2:-}";  shift 2;;
    -h|--help) usage 0;;
    *) die "unknown arg: $1";;
  esac
done

case "$disp" in
  accepted)
    body="Thanks for this, agreed, and I've added it to the roadmap. You can follow it on the board: ${BOARD}. No firm date, but it's on the list. Appreciate you taking the time."
    labels="accepted"; close="" ;;
  backlog)
    body="Thanks, I like this and I've put it on the backlog. Not something I'm picking up right now, but it's recorded and I'll revisit. Happy to hear more about your use case in the meantime."
    labels="backlog"; close="" ;;
  needs-info)
    body="Thanks for the report. I can't quite reproduce this yet, could you add the OS, file size, and exact steps (a small sample file helps too)? I'll pick it straight back up once I can see it."
    labels="needs-info"; close="" ;;
  duplicate)
    [ -n "$dup" ] || die "duplicate needs --dup <issue#>"
    body="Thanks! This is already tracked in #${dup}, so I'll close this in favour of that one to keep the conversation in one place. Please add anything extra over there."
    labels="duplicate"; close="not planned" ;;
  wontfix-scope)
    body="Thank you for suggesting this. It's a reasonable idea, but it's out of scope for tuhi right now, I'm keeping the surface small while the core gets solid. I'm not ruling it out forever, and I'll leave the reasoning here for anyone who finds this later. Genuinely appreciate the thought."
    labels="wontfix:scope"; close="not planned" ;;
  wontfix-vision)
    body="Thanks for taking the time on this. I'm going to pass, because it pulls against one of tuhi's deliberate non-goals (see VISION.md). That's a choice, not a criticism of the idea, tuhi stays small and fast on purpose. If you think the non-goal itself is wrong, I'd genuinely welcome that as a Discussion."
    labels="wontfix:vision"; close="not planned" ;;
  *) die "unknown disposition: $disp" ;;
esac

full="$body"
[ -n "$note" ] && full="${note}

${body}"

echo "--- issue #$issue -> $disp ---"
echo "$full"
echo "label: +$labels -needs-triage${close:+   close: $close}"
printf 'Proceed? [y/N] '
read -r ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || die "aborted"

gh issue comment "$issue" --body "$full"
gh issue edit "$issue" --add-label "$labels" --remove-label needs-triage || true
[ -n "$close" ] && gh issue close "$issue" --reason "$close"
echo "done."
