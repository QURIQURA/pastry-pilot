-- PROPOSED ONLY: do not execute until dependency and permission review.
-- Target Supabase project: SHCS business DB (meswjzwxldhqkjglnmzt).
-- Restrict client roles without dropping existing diagnostic records.
BEGIN;
REVOKE ALL PRIVILEGES ON TABLE public._ddl_probe FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public._sync_debug_log FROM anon, authenticated;
ALTER TABLE public._ddl_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._sync_debug_log ENABLE ROW LEVEL SECURITY;
COMMIT;

-- Post-apply verification (read-only):
-- SELECT relname, relrowsecurity FROM pg_class WHERE oid IN
--   ('public._ddl_probe'::regclass, 'public._sync_debug_log'::regclass);
-- SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_schema='public' AND table_name IN ('_ddl_probe','_sync_debug_log')
-- AND grantee IN ('anon','authenticated');

-- Rollback ONLY if explicitly approved after impact assessment:
-- BEGIN;
-- ALTER TABLE public._ddl_probe DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public._sync_debug_log DISABLE ROW LEVEL SECURITY;
-- GRANT ALL PRIVILEGES ON TABLE public._ddl_probe TO anon, authenticated;
-- GRANT ALL PRIVILEGES ON TABLE public._sync_debug_log TO anon, authenticated;
-- COMMIT;
-- Warning: rollback restores the insecure original grants; not recommended.
