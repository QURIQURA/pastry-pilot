-- A date-only production plan is not a timed work block and must not sync as a fake Planner appointment.
alter table public.work_session_formula_versions
  add column if not exists planned_date date;

comment on column public.work_session_formula_versions.planned_date is
  'Date-only production intent. A timed work_blocks row supersedes this for timeline scheduling.';
