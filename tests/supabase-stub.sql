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
  sheet_mould_id uuid
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
