-- Minimal stand-in for the Supabase parts our migrations and SQL tests rely on, for a throwaway
-- local Postgres in CI (pastry-pilot#20). Never run this against a real Supabase project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create or replace function public.update_updated_at_column() returns trigger language plpgsql as
  $$ begin new.updated_at = now(); return new; end $$;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key, name text);
insert into auth.users values ('53e168e4-72aa-418e-812a-6caaf315a205'), ('00000000-0000-0000-0000-0000000000b2')
  on conflict do nothing;

-- The deployment applier intentionally skips pre-automation migrations. These fixtures
-- represent the existing tables used by newer production migrations in isolated CI.
create table if not exists public.orders (
  id uuid primary key,
  user_id uuid not null,
  cake_size_id uuid
);
create table if not exists public.work_sessions (
  id uuid primary key,
  user_id uuid not null,
  order_id uuid,
  cake_size_id uuid
);
create table if not exists public.cake_sizes (
  id uuid primary key,
  user_id uuid not null,
  sheet_mould_id uuid,
  kind text not null default 'CAKE' -- live since 20261113140000_cake_sizes_free_form
);
create table if not exists public.formulas (
  id uuid primary key,
  user_id uuid not null
);
create table if not exists public.formula_versions (
  id uuid primary key,
  user_id uuid not null,
  default_mould_id uuid
);
create table if not exists public.moulds (
  id uuid primary key,
  user_id uuid not null,
  reference_weight_g numeric
);
create table if not exists public.work_session_formula_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  work_session_id uuid not null,
  formula_version_id uuid not null,
  kind text not null default 'CORE',
  slot text,
  mould_id uuid,
  mould_qty numeric,
  capacity_id uuid,
  capacity_qty numeric,
  multiplier numeric not null default 1
);

-- pastry-pilot#71: pop-up columns, settings and audit log used by the REJECTED pop-up migration.
alter table public.orders add column if not exists order_kind text not null default 'CAKE';
alter table public.orders add column if not exists order_number text;
alter table public.orders add column if not exists status text not null default 'INTAKE';
alter table public.orders add column if not exists popup_plan jsonb not null default '{}'::jsonb;
alter table public.orders add column if not exists pickup_at timestamptz;
alter table public.orders add column if not exists event_date date;
alter table public.orders add column if not exists updated_at timestamptz not null default now();
alter table public.orders alter column id set default gen_random_uuid();
create table if not exists public.pilot_settings (
  user_id uuid primary key,
  popup_workflow jsonb not null default '[{"id":"PLANNING","label":"CONFIRMED"},{"id":"PREPARING","label":"MENU PLANNING"},{"id":"COMPLETED","label":"COMPLETED"}]'::jsonb,
  popup_next_number integer not null default 1
);
create table if not exists public.order_production_sync_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  order_id uuid,
  source text not null,
  before_value jsonb,
  after_value jsonb
);
-- Pre-baseline RPC (20261105084410), unchanged by later migrations; the pop-up SQL test calls it.
create or replace function public.save_popup_stage(p_order_id uuid,p_stage_id text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old_order public.orders%rowtype; saved public.orders%rowtype;
begin
  select * into old_order from public.orders where id=p_order_id and user_id=auth.uid() and order_kind='POPUP' for update;
  if not found then raise exception '팝업에 접근할 수 없습니다'; end if;
  if p_expected_updated_at is null or old_order.updated_at<>p_expected_updated_at then raise exception '다른 화면에서 변경됐습니다. 최신 값을 불러오세요'; end if;
  update public.orders set popup_plan=jsonb_set(popup_plan,'{stage_id}',to_jsonb(p_stage_id)) where id=p_order_id and user_id=auth.uid() returning * into saved;
  insert into public.order_production_sync_log(user_id,order_id,source,before_value,after_value)
    values(auth.uid(),p_order_id,'popup_stage',to_jsonb(old_order),to_jsonb(saved));
  return to_jsonb(saved);
end; $$;
grant execute on function public.save_popup_stage(uuid,text,timestamptz) to authenticated;
