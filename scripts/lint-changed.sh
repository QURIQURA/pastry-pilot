#!/usr/bin/env bash
# pastry-pilot#18: lint what a change touches without failing on formatting that is already on main.
# New files get the full eslint config (prettier included). Modified files get eslint with the
# prettier rule off, because main still has thousands of existing prettier findings.
# Generated files (Supabase types, route tree) are skipped. Usage: scripts/lint-changed.sh <base>
set -euo pipefail
base="${1:?usage: lint-changed.sh <base-sha>}"
skip='^(src/routeTree\.gen\.ts|src/integrations/supabase/types\.ts)$'
pick() { git diff --name-only --diff-filter="$1" "$base" HEAD -- '*.ts' '*.tsx' '*.mjs' '*.js' | grep -Ev "$skip" || true; }
added=$(pick A)
modified=$(pick MR)
status=0
if [ -n "$added" ]; then echo "New files:"; echo "$added"; echo "$added" | xargs npx eslint || status=1; fi
if [ -n "$modified" ]; then
  echo "Modified files (prettier rule off):"; echo "$modified"
  echo "$modified" | xargs npx eslint --rule 'prettier/prettier: off' || status=1
fi
[ -n "$added$modified" ] || echo "No lintable files changed."
exit $status
