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
rollback;
