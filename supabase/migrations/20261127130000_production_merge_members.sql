-- YEON OS Issue #82: persisted weighing-batch memberships only.
-- No changes to recipes, actual production records, order allocations, or history.
-- work_date is the day on which the combined batch is weighed. Members can
-- retain original planned work-block dates; source work blocks are untouched.
create table if not exists public.production_merge_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  selection_id uuid not null references public.work_session_formula_versions(id) on delete cascade,
  batch_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, work_date, selection_id)
);
create index if not exists production_merge_members_batch_idx
  on public.production_merge_members(user_id, work_date, batch_id);
alter table public.production_merge_members enable row level security;
drop policy if exists "own production_merge_members" on public.production_merge_members;
create policy "own production_merge_members" on public.production_merge_members
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.production_merge_members to authenticated;
grant all on public.production_merge_members to service_role;

-- Atomic join/unmerge. Guard the caller, version and all existing group members.
-- No stored quantity: the original selection multipliers and formula lines remain authoritative.
create or replace function public.production_merge_change(
  p_work_date date, p_selection_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
  v_versions integer;
  v_version uuid;
  v_batch uuid;
  v_groups uuid[];
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_work_date is null or p_selection_ids is null or cardinality(p_selection_ids) not between 1 and 100
      or array_position(p_selection_ids, null) is not null
      or (select count(distinct item) from unnest(p_selection_ids) item) <> cardinality(p_selection_ids)
  then raise exception 'Invalid production merge selection'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text || ':' || p_work_date::text, 0)
  );
  select count(*), count(distinct formula_version_id)
    into v_count, v_versions
  from public.work_session_formula_versions
  where id = any(p_selection_ids) and user_id = v_user;
  select formula_version_id into v_version from public.work_session_formula_versions
    where id = p_selection_ids[1] and user_id = v_user;
  if v_count <> cardinality(p_selection_ids) or v_versions <> 1 then
    raise exception 'All selections must belong to the caller and use one Formula Version';
  end if;
  if cardinality(p_selection_ids) = 1 then
    select batch_id into v_batch from public.production_merge_members
    where user_id = v_user and work_date = p_work_date
      and selection_id = p_selection_ids[1];
    if v_batch is not null then
      delete from public.production_merge_members
      where user_id = v_user and work_date = p_work_date and batch_id = v_batch;
    end if;
  else
    if exists (
      select 1 from public.production_merge_members m
      join public.work_session_formula_versions s on s.id = m.selection_id
      where m.user_id = v_user and m.work_date = p_work_date
        and m.batch_id in (
          select batch_id from public.production_merge_members
          where user_id = v_user and work_date = p_work_date
            and selection_id = any(p_selection_ids)
        ) and (s.user_id <> v_user or s.formula_version_id <> v_version)
    ) then raise exception 'Existing batch has another Formula Version'; end if;
    select batch_id into v_batch
      from public.production_merge_members
      where user_id = v_user and work_date = p_work_date
        and selection_id = any(p_selection_ids)
      order by created_at, batch_id limit 1;
    v_batch := coalesce(v_batch, pg_catalog.gen_random_uuid());
    select array_agg(distinct batch_id) into v_groups
      from public.production_merge_members
      where user_id = v_user and work_date = p_work_date
        and selection_id = any(p_selection_ids);
    if v_groups is not null then
      update public.production_merge_members
        set batch_id = v_batch
        where user_id = v_user and work_date = p_work_date
          and batch_id = any(v_groups);
    end if;
    insert into public.production_merge_members (user_id, work_date, selection_id, batch_id)
      select v_user, p_work_date, item, v_batch
      from unnest(p_selection_ids) item
      on conflict (user_id, work_date, selection_id)
      do update set batch_id = excluded.batch_id;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_array(selection_id, batch_id) order by selection_id)
    from public.production_merge_members where user_id = v_user and work_date = p_work_date
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.production_merge_change(date, uuid[]) from public, anon;
grant execute on function public.production_merge_change(date, uuid[]) to authenticated;

-- Import localStorage mappings once per browser without overwriting a server batch.
-- Ignore whole legacy groups that overlap server members; do not silently reassign them.
create or replace function public.production_merge_import_legacy(
  p_work_date date, p_entries jsonb
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_total integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_work_date is null or pg_catalog.jsonb_typeof(p_entries) <> 'array'
    or pg_catalog.jsonb_array_length(p_entries) > 300 then
    raise exception 'Invalid legacy batch mapping';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text || ':' || p_work_date::text, 0)
  );
  -- Validate all legacy IDs before importing anything.
  with proposed as (
    select (value->>0)::uuid selection_id, (value->>1)::uuid batch_id
    from pg_catalog.jsonb_array_elements(p_entries)
  )
  select count(*) into v_total from proposed;
  if v_total = 0 then return false; end if;
  if exists (
    with proposed as (
      select (value->>0)::uuid selection_id, (value->>1)::uuid batch_id
      from pg_catalog.jsonb_array_elements(p_entries)
    )
    select 1 from proposed p
    left join public.work_session_formula_versions s
      on s.id = p.selection_id and s.user_id = v_user
    where s.id is null
  ) then raise exception 'Legacy batch contains missing or foreign selections'; end if;
  if exists (
    with proposed as (
      select (value->>0)::uuid selection_id, (value->>1)::uuid batch_id
      from pg_catalog.jsonb_array_elements(p_entries)
    )
    select 1 from proposed p
    join public.work_session_formula_versions s on s.id = p.selection_id
    group by p.batch_id having count(distinct s.formula_version_id) <> 1
  ) then raise exception 'Legacy batch contains mixed Formula Versions'; end if;
  with proposed as (
    select distinct (value->>0)::uuid selection_id, (value->>1)::uuid batch_id
    from pg_catalog.jsonb_array_elements(p_entries)
  ), eligible as (
    select p.batch_id from proposed p
    group by p.batch_id having count(*) > 1
  ), nonconflicting as (
    select e.batch_id from eligible e
    where not exists (
      select 1 from proposed p
      join public.production_merge_members m
        on m.user_id = v_user and m.work_date = p_work_date and m.selection_id = p.selection_id
      where p.batch_id = e.batch_id
    )
  )
  insert into public.production_merge_members (user_id, work_date, selection_id, batch_id)
    select v_user, p_work_date, p.selection_id, p.batch_id
    from proposed p join nonconflicting nc on nc.batch_id = p.batch_id
    on conflict (user_id, work_date, selection_id) do nothing;
  return true;
end;
$$;
revoke all on function public.production_merge_import_legacy(date, jsonb) from public, anon;
grant execute on function public.production_merge_import_legacy(date, jsonb) to authenticated;
