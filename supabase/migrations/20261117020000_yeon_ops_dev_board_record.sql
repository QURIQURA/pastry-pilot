-- pastry-pilot#20: let CI record Auto-Pilot progress on the Development Board without a new secret.
-- CI calls this through the Supabase Management API (SUPABASE_ACCESS_TOKEN, already a repo secret),
-- which runs as the database owner. No client role can call it: it lives in the private schema
-- yeon_ops and EXECUTE is revoked from public, anon and authenticated.
-- Idempotent per issue: github:<repo>#<issue> maps to one board item. Never sets VERIFIED.
-- Rollback: supabase/rollback/20261117020000_yeon_ops_dev_board_record_down.sql

create schema if not exists yeon_ops;
revoke all on schema yeon_ops from public, anon, authenticated;

create or replace function yeon_ops.dev_board_record(
  p_repo text, p_issue integer, p_pr integer default null, p_status text default null,
  p_note text default null, p_run_url text default null, p_title text default null)
returns uuid language plpgsql set search_path = '' as $$
declare
  owner constant uuid := '53e168e4-72aa-418e-812a-6caaf315a205';
  os text := case p_repo
    when 'QURIQURA/pastry-pilot' then 'PILOT'
    when 'QURIQURA/shcs-order' then 'SHCS'
    when 'QURIQURA/wann-planner' then 'PLANNER' end;
  issue_key text := 'github:' || p_repo || '#' || p_issue;
  item uuid;
  next_no int;
  line text;
begin
  if os is null then raise exception 'repo not allowed'; end if;
  if p_issue is null or p_issue <= 0 then raise exception 'issue required'; end if;
  if p_status is not null and p_status not in
      ('IMPLEMENTING','PR_OPEN','REVIEWING','MERGED','DEPLOYED','BLOCKED','FAILED') then
    raise exception 'status not allowed from CI';
  end if;
  if p_run_url is not null and p_run_url !~ '^https://github\.com/' then raise exception 'bad run url'; end if;

  -- Serialise concurrent reports so one issue never gets two items.
  perform pg_advisory_xact_lock(hashtext('yeon_ops.dev_board_record'));

  select work_item_id into item from public.dev_work_refs
    where user_id = owner and sync_key = issue_key limit 1;
  if item is null then
    select coalesce(max((substring(work_key from '^YOS-(\d+)$'))::int), 0) + 1 into next_no
      from public.dev_work_items where user_id = owner;
    insert into public.dev_work_items(user_id, work_key, title, owning_os, affected_os, status)
      values (owner, 'YOS-' || lpad(next_no::text, 3, '0'),
        coalesce(nullif(left(btrim(p_title), 200), ''), split_part(p_repo, '/', 2) || ' #' || p_issue),
        os, array[os], coalesce(p_status, 'IMPLEMENTING'))
      returning id into item;
    insert into public.dev_work_refs(user_id, work_item_id, kind, repo, number, url, sync_key)
      values (owner, item, 'ISSUE', p_repo, p_issue,
        'https://github.com/' || p_repo || '/issues/' || p_issue, issue_key);
  end if;

  if p_pr is not null and p_pr > 0 then
    insert into public.dev_work_refs(user_id, work_item_id, kind, repo, number, url, sync_key)
      values (owner, item, 'PR', p_repo, p_pr, 'https://github.com/' || p_repo || '/pull/' || p_pr,
        'github:' || p_repo || '#' || p_pr)
      on conflict (work_item_id, sync_key) do nothing;
  end if;

  if p_status is not null then
    update public.dev_work_items set status = p_status where id = item and status is distinct from p_status;
  end if;
  if nullif(btrim(p_note), '') is not null then
    line := '[' || to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD HH24:MI') || ' Sydney] '
      || left(btrim(p_note), 500) || coalesce(' (' || p_run_url || ')', '');
    -- Newest first, keep the last 40 lines.
    update public.dev_work_items
      set implementation_notes = array_to_string((array_prepend(line,
        coalesce(string_to_array(implementation_notes, E'\n'), '{}')))[1:40], E'\n')
      where id = item;
  end if;
  return item;
end $$;

revoke all on function yeon_ops.dev_board_record(text, integer, integer, text, text, text, text)
  from public, anon, authenticated;
