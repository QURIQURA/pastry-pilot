-- Issue #82: isolated transaction on throwaway CI Postgres, never operating records.
begin;
insert into public.formula_versions(id,user_id) values
 ('10000000-0000-0000-0000-000000000001','53e168e4-72aa-418e-812a-6caaf315a205'),
 ('10000000-0000-0000-0000-000000000002','53e168e4-72aa-418e-812a-6caaf315a205');
insert into public.work_sessions(id,user_id) values
 ('20000000-0000-0000-0000-000000000001','53e168e4-72aa-418e-812a-6caaf315a205'),
 ('20000000-0000-0000-0000-000000000002','53e168e4-72aa-418e-812a-6caaf315a205');
insert into public.work_session_formula_versions(id,user_id,work_session_id,formula_version_id,multiplier)
values
 ('30000000-0000-0000-0000-000000000001','53e168e4-72aa-418e-812a-6caaf315a205','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',0.914285714),
 ('30000000-0000-0000-0000-000000000002','53e168e4-72aa-418e-812a-6caaf315a205','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',0.666666667),
 ('30000000-0000-0000-0000-000000000003','53e168e4-72aa-418e-812a-6caaf315a205','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',1),
 ('30000000-0000-0000-0000-000000000004','53e168e4-72aa-418e-812a-6caaf315a205','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',1);
set local role authenticated;
set local request.jwt.claim.sub = '53e168e4-72aa-418e-812a-6caaf315a205';
select public.production_merge_change('2026-11-27', array[
 '30000000-0000-0000-0000-000000000001'::uuid,
 '30000000-0000-0000-0000-000000000002'::uuid
]);
do $$
begin
 if (select count(distinct batch_id) from public.production_merge_members where work_date='2026-11-27') <> 1
    or (select count(*) from public.production_merge_members where work_date='2026-11-27') <> 2
 then raise exception 'same-version join did not persist'; end if;
end; $$;
select public.production_merge_change('2026-11-27', array[
 '30000000-0000-0000-0000-000000000002'::uuid,
 '30000000-0000-0000-0000-000000000003'::uuid
]);
do $$
begin
 if (select count(*) from public.production_merge_members where work_date='2026-11-27') <> 3
    or (select count(distinct batch_id) from public.production_merge_members where work_date='2026-11-27') <> 1
 then raise exception 'extending batch lost members'; end if;
 if (select count(*) from public.work_session_formula_versions where id in (
   '30000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002'
 ) and multiplier in (0.914285714,0.666666667)) <> 2
 then raise exception 'source quantities were changed'; end if;
end; $$;
do $$
begin
 begin
  perform public.production_merge_change('2026-11-27', array[
    '30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000004'::uuid
  ]);
  raise exception 'mixed version erroneously accepted';
 exception when others then
  if sqlerrm = 'mixed version erroneously accepted' then raise; end if;
 end;
end; $$;
select public.production_merge_change('2026-11-27', array['30000000-0000-0000-0000-000000000001'::uuid]);
do $$
begin
 if exists (select 1 from public.production_merge_members where work_date='2026-11-27')
 then raise exception 'unmerge did not clear only the target group'; end if;
end; $$;
-- Legacy groups can be imported without overwriting remote state.
select public.production_merge_import_legacy('2026-11-27',
 '[["30000000-0000-0000-0000-000000000001","40000000-0000-0000-0000-000000000001"],["30000000-0000-0000-0000-000000000002","40000000-0000-0000-0000-000000000001"]]'::jsonb);
do $$
begin
 if (select count(*) from public.production_merge_members where work_date='2026-11-27') <> 2
 then raise exception 'legacy import lost members'; end if;
end; $$;
rollback;
