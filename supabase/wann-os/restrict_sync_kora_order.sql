-- WANN OS 프로젝트(txrxzsrjqwhvjosutotp)에서 실행하는 SQL의 기록용 사본 (KORA 마이그레이션 아님).
-- 이유: sync_kora_order(SECURITY DEFINER)가 anon/authenticated에도 EXECUTE 권한이 있어,
--       공개 anon 키만으로 아무 user_id의 Planner 프로젝트/task를 만들거나 id로 덮어쓸 수 있다.
-- 근거: KORA의 sync_confirmed_order_to_planner 트리거와 sync_popup_order_to_planner 트리거는
--       같은 vault 시크릿(wann_os_secret_key)을 쓰고, service_role 전용인 sync_kora_popup 호출이
--       2026-11-13에 성공했다 → 이 시크릿은 service_role 권한이다. wann-planner 프론트엔드 코드에는
--       sync_kora_order 호출이 없다. 따라서 아래 REVOKE 후에도 기존 연동은 그대로 동작해야 한다.
-- 되돌리기: grant execute on function ... to anon, authenticated;

revoke execute on function public.sync_kora_order(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.sync_kora_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_kora_order(jsonb, jsonb, jsonb) to service_role;
grant execute on function public.sync_kora_order(jsonb, jsonb) to service_role;

-- 확인 (모두 anon=false, authenticated=false, service_role=true 여야 함):
-- select pg_get_function_identity_arguments(p.oid) args,
--        has_function_privilege('anon', p.oid, 'execute') anon,
--        has_function_privilege('authenticated', p.oid, 'execute') authenticated,
--        has_function_privilege('service_role', p.oid, 'execute') service_role
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'sync_kora_order';
