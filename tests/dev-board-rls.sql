-- pastry-pilot#17 Development Board RLS checks. Runs inside a transaction and rolls back,
-- so it leaves no data behind. Usage: psql -v ON_ERROR_STOP=1 -f tests/dev-board-rls.sql
-- Needs two existing auth.users ids: A = PILOT owner, B = any other user (set below).
begin;
select set_config('test.a', '53e168e4-72aa-418e-812a-6caaf315a205', true);
select set_config('test.b', coalesce(
  (select id::text from auth.users where id <> '53e168e4-72aa-418e-812a-6caaf315a205' limit 1),
  '00000000-0000-0000-0000-0000000000b2'), true);

-- As user A: create two items, link them, add a ref, change status.
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;
do $$
declare a uuid := current_setting('test.a')::uuid; x uuid; y uuid; n int; failed boolean;
begin
  insert into public.dev_work_items(work_key, title, affected_os) values ('T-RLS-1', 'rls one', array['PILOT','SHCS'])
    returning id into x;
  insert into public.dev_work_items(work_key, title) values ('T-RLS-2', 'rls two') returning id into y;
  if (select user_id from public.dev_work_items where id = x) <> a then raise exception 'user_id default wrong'; end if;
  insert into public.dev_work_relations(from_id, to_id, kind) values (x, y, 'DEPENDS_ON');
  insert into public.dev_work_refs(work_item_id, kind, repo, number, url, sync_key)
    values (x, 'PR', 'QURIQURA/pastry-pilot', 1, 'https://github.com/QURIQURA/pastry-pilot/pull/1',
            'github:QURIQURA/pastry-pilot#1');
  update public.dev_work_items set status = 'MERGED' where id = x;
  select count(*) into n from public.dev_work_events where work_item_id = x;
  if n <> 2 then raise exception 'expected 2 status events, got %', n; end if;

  failed := false;
  begin insert into public.dev_work_items(work_key, title, affected_os) values ('T-RLS-3', 'bad', array['NOPE']);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'invalid affected_os accepted'; end if;

  failed := false;
  begin insert into public.dev_work_relations(from_id, to_id) values (x, x);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'self relation accepted'; end if;

  failed := false;
  begin insert into public.dev_work_events(user_id, work_item_id, to_status) values (a, x, 'VERIFIED');
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'client could forge a status event'; end if;
  perform set_config('test.x', x::text, true);
end $$;

-- As user B: cannot see, edit or link into A's items.
reset role;
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
set local role authenticated;
do $$
declare x uuid := current_setting('test.x')::uuid; mine uuid; n int; failed boolean;
begin
  select count(*) into n from public.dev_work_items where work_key like 'T-RLS-%';
  if n <> 0 then raise exception 'user B can see A items'; end if;
  select count(*) into n from public.dev_work_events where work_item_id = x;
  if n <> 0 then raise exception 'user B can see A events'; end if;
  update public.dev_work_items set title = 'hijack' where id = x;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'user B updated A item'; end if;

  insert into public.dev_work_items(work_key, title) values ('T-RLS-B', 'b item') returning id into mine;
  failed := false;
  begin insert into public.dev_work_relations(from_id, to_id) values (mine, x);
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'user B linked into A item'; end if;

  failed := false;
  begin insert into public.dev_work_refs(work_item_id, kind, url, sync_key)
    values (x, 'DOC', 'https://example.com', 'url:https://example.com');
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'user B added a ref to A item'; end if;
end $$;

-- Anon: no access at all.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare failed boolean := false;
begin
  begin perform 1 from public.dev_work_items limit 1;
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'anon can read dev_work_items'; end if;
end $$;

reset role;
select 'dev-board RLS: all checks passed' as result;
rollback;
