-- Rollback for 20261117010000_yeon_os_dev_board.sql (pastry-pilot#17).
-- Drops only the Development Board objects; no other PILOT, SHCS or Planner data is touched.
-- This deletes all board records, so export them first if you want to keep them.
drop trigger if exists dev_work_items_log_status on public.dev_work_items;
drop function if exists public.dev_work_log_status();
drop table if exists public.dev_work_events;
drop table if exists public.dev_work_refs;
drop table if exists public.dev_work_relations;
drop table if exists public.dev_work_items;
