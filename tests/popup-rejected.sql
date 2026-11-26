-- pastry-pilot#71: REJECTED pop-ups leave SND numbering, keep their notes, and never renumber others.
-- Runs on the throwaway CI database (scripts/sql-tests.sh) after the migrations. Rolled back at the end.
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
grant select,insert,update on public.orders,public.pilot_settings,public.order_production_sync_log to authenticated;
set local role authenticated;
do $$
declare uid uuid:=auth.uid(); a public.orders%rowtype; b public.orders%rowtype; c public.orders%rowtype;
  d public.orders%rowtype; plan jsonb; failed boolean;
begin
  plan:=jsonb_build_object('title','SND TEST','notes','memo to keep','items','[]'::jsonb,'checklist','[]'::jsonb);
  insert into public.orders(user_id,order_kind,popup_plan) values(uid,'POPUP',plan) returning * into a;
  insert into public.orders(user_id,order_kind,popup_plan) values(uid,'POPUP',plan) returning * into b;
  insert into public.orders(user_id,order_kind,popup_plan) values(uid,'POPUP',plan) returning * into c;
  if a.order_number<>'SND-001' or b.order_number<>'SND-002' or c.order_number<>'SND-003' then
    raise exception 'setup numbering: % % %',a.order_number,b.order_number,c.order_number; end if;
  update public.orders set popup_plan=jsonb_set(popup_plan,'{stage_id}','"COMPLETED"') where id=a.id;

  -- Reject the latest one: recoded, memo kept, status REJECTED.
  perform public.save_popup_stage(c.id,'REJECTED',c.updated_at);
  select * into c from public.orders where id=c.id;
  if c.order_number<>'SND-REJ-001' or c.status<>'REJECTED' then raise exception 'reject recode: % %',c.order_number,c.status; end if;
  if c.popup_plan->>'notes'<>'memo to keep' or c.popup_plan->>'original_number'<>'SND-003' or c.popup_plan->>'rejected_at' is null then
    raise exception 'rejection lost data: %',c.popup_plan; end if;

  -- Next pop-up reuses the freed number; earlier numbers are untouched.
  insert into public.orders(user_id,order_kind,popup_plan) values(uid,'POPUP',plan) returning * into d;
  if d.order_number<>'SND-003' then raise exception 'next number did not skip rejected: %',d.order_number; end if;
  if (select order_number from public.orders where id=a.id)<>'SND-001' or (select order_number from public.orders where id=b.id)<>'SND-002' then
    raise exception 'existing numbers changed'; end if;

  -- Reject a middle one: its own REJ counter, later numbers stay.
  select * into b from public.orders where id=b.id;
  perform public.save_popup_order_details(b.id,b.updated_at,jsonb_set(b.popup_plan,'{stage_id}','"REJECTED"'),null,b.status,b.order_number);
  select * into b from public.orders where id=b.id;
  if b.order_number<>'SND-REJ-002' then raise exception 'details save undid recode: %',b.order_number; end if;
  if (select order_number from public.orders where id=d.id)<>'SND-003' then raise exception 'later number shifted'; end if;

  -- A client that drops unknown keys keeps the rejection record.
  perform public.save_popup_order(b.id,b.updated_at,(b.popup_plan-'original_number'-'rejected_at')||'{"notes":"edited"}',null,'REJECTED');
  select * into b from public.orders where id=b.id;
  if b.popup_plan->>'original_number'<>'SND-002' or b.popup_plan->>'notes'<>'edited' then raise exception 'rejection record lost on save'; end if;

  -- Restore: takes the next active number.
  perform public.save_popup_stage(b.id,'PLANNING',b.updated_at);
  select * into b from public.orders where id=b.id;
  if b.order_number<>'SND-004' or b.status<>'CONFIRMED' or b.popup_plan->>'rejected_number'<>'SND-REJ-002' then
    raise exception 'restore: % % %',b.order_number,b.status,b.popup_plan; end if;

  -- Manual renames stay blocked; REJECTED cannot be a cake status or an editable workflow stage.
  failed:=false;
  begin update public.orders set order_number='SND-999' where id=d.id; exception when others then failed:=true; end;
  if not failed then raise exception 'order number became mutable'; end if;
  failed:=false;
  begin update public.orders set order_number='SND-998' where id=b.id; exception when others then failed:=true; end;
  if not failed then raise exception 'recoded row became mutable'; end if;
  failed:=false;
  begin insert into public.orders(user_id,status) values(uid,'REJECTED'); exception when check_violation then failed:=true; end;
  if not failed then raise exception 'cake order accepted REJECTED'; end if;
  failed:=false;
  begin update public.pilot_settings set popup_workflow='[{"id":"REJECTED","label":"x"},{"id":"COMPLETED","label":"COMPLETED"}]' where user_id=uid;
  exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'REJECTED accepted as editable stage'; end if;
  -- A rejected pop-up must not block editing the workflow.
  update public.pilot_settings set popup_workflow='[{"id":"PLANNING","label":"CONFIRMED"},{"id":"COMPLETED","label":"COMPLETED"}]' where user_id=uid;
end $$;
select 'PASS: popup REJECTED recode, numbering, data retention, restore, immutability' as result;
rollback;
