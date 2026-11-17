#!/usr/bin/env bash
# pastry-pilot#20: thin wrapper kept so workflows have one call. See scripts/dev-board-report.mjs.
# Usage: scripts/dev-board-report.sh <issue> <STATUS|-> "<note>" [pr]. Always exits 0.
node "$(dirname "$0")/dev-board-report.mjs" "$@" || true
exit 0
