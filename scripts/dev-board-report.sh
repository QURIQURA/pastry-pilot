#!/usr/bin/env bash
# pastry-pilot#18: record Auto-Pilot progress on the YEON OS Development Board.
# Usage: scripts/dev-board-report.sh <issue-number> <STATUS|-> "<note>" [pr-number]
# Needs env SUPABASE_URL and DEV_BOARD_INGEST_TOKEN; without them it prints a notice and exits 0.
# Never fails the calling workflow: the board is a view, GitHub stays the record.
set -uo pipefail
issue="${1:-}"; status="${2:--}"; note="${3:-}"; pr="${4:-}"
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${DEV_BOARD_INGEST_TOKEN:-}" ] || [ -z "$issue" ]; then
  echo "Dev Board report skipped (SUPABASE_URL / DEV_BOARD_INGEST_TOKEN not set, or no issue)."; exit 0
fi
[ "$status" = "-" ] && status=""
run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
body=$(ISSUE="$issue" STATUS="$status" NOTE="$note" PR="$pr" RUN_URL="$run_url" REPO="${GITHUB_REPOSITORY:-}" TITLE="${ISSUE_TITLE:-}" node -e '
const e = process.env;
const b = { repo: e.REPO, issue_number: Number(e.ISSUE), note: e.NOTE, run_url: e.RUN_URL };
if (e.STATUS) b.status = e.STATUS;
if (e.PR) b.pr_number = Number(e.PR);
if (e.TITLE) b.title = e.TITLE;
process.stdout.write(JSON.stringify(b));')
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${SUPABASE_URL%/}/functions/v1/dev-board-ingest" \
  -H "Content-Type: application/json" -H "x-yeon-ingest-token: ${DEV_BOARD_INGEST_TOKEN}" --data "$body" || echo 000)
echo "Dev Board report: HTTP $code"
exit 0
