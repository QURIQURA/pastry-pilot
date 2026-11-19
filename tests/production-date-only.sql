-- Exercises the real post-baseline trigger and date-only migration on CI fixtures.
begin;
insert into public.work_session_formula_versions
  (user_id, work_session_id, formula_version_id, slot, planned_date)
values
  ('00000000-0000-0000-0000-0000000000b2', gen_random_uuid(), gen_random_uuid(), 'SHEET', '2026-11-20');
do $$
begin
  if not exists (select 1 from public.work_session_formula_versions where planned_date = '2026-11-20') then
    raise exception 'Date-only plan was not persisted';
  end if;
  update public.work_session_formula_versions set planned_date = null where planned_date = '2026-11-20';
  if not found then raise exception 'Date-only plan was not cleared'; end if;
end $$;
update public.work_session_formula_versions set batter_split_g = array[681,680]
where user_id = '00000000-0000-0000-0000-0000000000b2';
do $$
begin
  if not exists (select 1 from public.work_session_formula_versions where batter_split_g = array[681,680]) then
    raise exception 'Batter split was not persisted';
  end if;
  begin
    update public.work_session_formula_versions set batter_split_g = array[681,0];
    raise exception 'Invalid allocation was accepted';
  exception when check_violation then
    null;
  end;
end $$;
-- The order sheet trigger may set a derived multiplier only when the mould is inferred.
do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-0000000000b2';
  size_id uuid := gen_random_uuid();
  order_id uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  version_id uuid := gen_random_uuid();
  base_id uuid := gen_random_uuid();
  finished_id uuid := gen_random_uuid();
  saved_multiplier numeric;
begin
  insert into public.moulds values (base_id, owner_id, 340), (finished_id, owner_id, 680);
  insert into public.cake_sizes values (size_id, owner_id, finished_id);
  insert into public.orders values (order_id, owner_id, size_id);
  insert into public.work_sessions values (session_id, owner_id, order_id, size_id);
  insert into public.formula_versions values (version_id, owner_id, base_id);
  insert into public.work_session_formula_versions
    (user_id, work_session_id, formula_version_id, slot, mould_id, mould_qty, multiplier)
  values (owner_id, session_id, version_id, 'SHEET', finished_id, 1, 1)
  returning multiplier into saved_multiplier;
  if saved_multiplier is distinct from 1 then
    raise exception 'An explicit finished mould must preserve the requested recipe batch';
  end if;
end $$;
rollback;
