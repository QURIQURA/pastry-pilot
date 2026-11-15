# Security review: debug table exposure

Related: #5. **Draft proposal only — not applied to Supabase.**

## Observed in live SHCS database (2026-11-15)
- `public._ddl_probe`: 0 rows, RLS disabled, anon/authenticated have broad privileges.
- `public._sync_debug_log`: 6 rows, RLS disabled, anon/authenticated have broad privileges. Contains free-text `step` and `detail` fields; contents deliberately not reproduced.
- Catalog searches found no direct references in public SQL function bodies, trigger definitions or dependent views. This does not rule out app, external API, dynamic SQL or service-role dependencies.

## Proposal
Apply [restrict_debug_tables.sql](restrict_debug_tables.sql) **only after explicit approval** and code/dependency review. REVOKE client roles and ENABLE RLS. No rows are deleted and no business tables are modified.

## Acceptance checks
- [ ] Search SHCS, Pilot and other consumers for these table names (including migrations/scripts)
- [ ] Check service-role and admin diagnostics expectations
- [ ] Approve production change window and rollback
- [ ] Execute migration through reviewed deployment mechanism
- [ ] Confirm anon/authenticated grants absent and RLS enabled
- [ ] Smoke-test SHCS order intake, Pilot order management, Planner sync and relevant admin tools

## Caveat
The rollback in the SQL is illustrative only; regranting broad privileges would reintroduce the security exposure. Prefer diagnosing any affected caller and granting least privilege instead.
