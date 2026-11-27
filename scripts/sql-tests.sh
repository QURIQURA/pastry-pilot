#!/usr/bin/env bash
# pastry-pilot#20: apply new migrations to a throwaway local Postgres through the real CI applier,
# twice (must be idempotent), then run the SQL tests. Needs SUPABASE_DB_URL pointing at that local
# database. Never point it at the live project.
set -euo pipefail
case "${SUPABASE_DB_URL:-}" in
  *localhost*|*127.0.0.1*|*host=/*) ;;
  *) echo "sql-tests.sh only runs against a local database" >&2; exit 1 ;;
esac
psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -f tests/supabase-stub.sql
node scripts/supabase-migrate.mjs apply
node scripts/supabase-migrate.mjs apply   # second run must find nothing to do
psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -f tests/dev-board-rls.sql
psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -f tests/production-date-only.sql
psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -f tests/popup-rejected.sql
psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -f tests/production-merge.sql
echo "SQL tests passed."
