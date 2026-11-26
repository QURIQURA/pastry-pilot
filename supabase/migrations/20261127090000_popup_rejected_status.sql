-- 2026-11-27 (연, pastry-pilot#71): pop-up 반려(REJECTED) 상태.
--
-- * REJECTED is a fixed system stage, outside the editable pop-up workflow (pilot_settings.popup_workflow).
--   orders.status = 'REJECTED' is allowed for POPUP rows only. Cake orders are unchanged.
-- * Entering REJECTED recodes the pop-up to SND-REJ-nnn (its own counter). The previous number is kept in
--   popup_plan.original_number with popup_plan.rejected_at. Notes, items and checklist stay. Nothing is deleted.
-- * Leaving REJECTED gives the pop-up the next active SND number.
-- * New pop-ups take max(active SND-nnn) + 1, so a rejected number at the end is reused.
--   Existing active/completed numbers never change.
-- * shcs_protect_canonical_order_number keeps every other order number immutable. Only this server-side
--   recode, for the same row in the same statement, passes.
--
-- Idempotent: safe to run in the SQL editor and again through scripts/supabase-migrate.mjs.

-- 1. Status value -----------------------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status = any (array['INTAKE','CONFIRMED','DESIGN','PRODUCTION','FINAL_TOUCH','DELIVERY','COMPLETED'])
  or (status = 'REJECTED' and order_kind = 'POPUP')
);

-- 2. Stage → status (REJECTED accepted even though it is not in the editable workflow) -------------------
create or replace function public.normalize_snl_stage()
returns trigger language plpgsql security invoker set search_path='' as $$
declare stages jsonb; stage_id text;
begin
  if new.order_kind<>'POPUP' then return new; end if;
  if auth.uid() is null or new.user_id is distinct from auth.uid() then raise exception '팝업 소유권을 확인하세요'; end if;
  insert into public.pilot_settings(user_id) values(new.user_id) on conflict(user_id) do nothing;
  select popup_workflow into stages from public.pilot_settings where user_id=new.user_id for update;
  stage_id:=nullif(new.popup_plan->>'stage_id','');
  if stage_id is null and tg_op='UPDATE' then stage_id:=nullif(old.popup_plan->>'stage_id',''); end if;
  stage_id:=coalesce(stage_id,case when new.status='COMPLETED' then 'COMPLETED' when new.status='REJECTED' then 'REJECTED' else stages->0->>'id' end);
  if stage_id<>'REJECTED' and not exists(select 1 from jsonb_array_elements(stages) stage_row where stage_row->>'id'=stage_id) then raise exception '사용 가능한 팝업 진행 단계를 선택하세요'; end if;
  new.popup_plan:=jsonb_set(new.popup_plan,'{stage_id}',to_jsonb(stage_id));
  new.status:=case when stage_id='REJECTED' then 'REJECTED' when stage_id='COMPLETED' then 'COMPLETED' when stage_id=stages->0->>'id' then 'CONFIRMED' else 'PRODUCTION' end;
  return new;
end; $$;
revoke all on function public.normalize_snl_stage() from public,anon;
create or replace trigger a_normalize_snl_stage before insert or update of order_kind,popup_plan,status,user_id on public.orders
  for each row execute function public.normalize_snl_stage();

-- 3. New pop-up numbers skip rejected ones (SND-REJ-nnn never matches ^SN[LD]-[0-9]+$) ---------------------
create or replace function public.assign_snl_number()
returns trigger language plpgsql security invoker set search_path='' as $$
declare next_no integer;
begin
  if new.order_kind<>'POPUP' then return new; end if;
  if auth.uid() is null or new.user_id is distinct from auth.uid() then raise exception '팝업 소유권을 확인하세요'; end if;
  insert into public.pilot_settings(user_id) values(new.user_id) on conflict(user_id) do nothing;
  perform 1 from public.pilot_settings where user_id=new.user_id for update;  -- serialises numbering per user
  select coalesce(max(substring(order_number from '^SN[LD]-([0-9]+)$')::integer),0)+1 into next_no
    from public.orders where user_id=new.user_id and order_kind='POPUP' and order_number ~ '^SN[LD]-[0-9]+$';
  new.order_number:='SND-'||lpad(next_no::text,greatest(3,length(next_no::text)),'0');
  update public.pilot_settings set popup_next_number=next_no+1 where user_id=new.user_id;
  if new.popup_plan->>'title'='토요일 팝업' then new.popup_plan:=jsonb_set(new.popup_plan,'{title}','"Saturday Night Live"'::jsonb); end if;
  return new;
end; $$;
revoke all on function public.assign_snl_number() from public,anon;
create or replace trigger assign_snl_number before insert on public.orders
  for each row execute function public.assign_snl_number();

-- 4. Recode on reject / restore. Name sorts after a_normalize_snl_stage (status is final) and before
--    b_sync_popup_order_to_planner (Planner receives the new number) and shcs_protect_canonical_order_number.
create or replace function public.recode_rejected_popup()
returns trigger language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
  if new.order_kind<>'POPUP' then return new; end if;
  -- Older clients rebuild popup_plan from known keys only; keep the rejection record.
  if old.popup_plan ? 'original_number' and not (new.popup_plan ? 'original_number') then
    new.popup_plan:=new.popup_plan||jsonb_build_object('original_number',old.popup_plan->'original_number');
  end if;
  if old.popup_plan ? 'rejected_at' and not (new.popup_plan ? 'rejected_at') then
    new.popup_plan:=new.popup_plan||jsonb_build_object('rejected_at',old.popup_plan->'rejected_at');
  end if;
  if (old.status='REJECTED')=(new.status='REJECTED') then return new; end if;
  perform 1 from public.pilot_settings where user_id=new.user_id for update;
  if new.status='REJECTED' then
    if coalesce(old.order_number,'') !~ '^SND-REJ-[0-9]+$' then
      select coalesce(max(substring(order_number from '^SND-REJ-([0-9]+)$')::integer),0)+1 into n
        from public.orders where user_id=new.user_id and order_kind='POPUP' and order_number ~ '^SND-REJ-[0-9]+$';
      new.popup_plan:=new.popup_plan||jsonb_build_object('original_number',old.order_number,'rejected_at',now());
      new.order_number:='SND-REJ-'||lpad(n::text,greatest(3,length(n::text)),'0');
    end if;
  else
    select coalesce(max(substring(order_number from '^SN[LD]-([0-9]+)$')::integer),0)+1 into n
      from public.orders where user_id=new.user_id and order_kind='POPUP' and order_number ~ '^SN[LD]-[0-9]+$' and id<>new.id;
    new.popup_plan:=new.popup_plan||jsonb_build_object('rejected_number',old.order_number);
    new.order_number:='SND-'||lpad(n::text,greatest(3,length(n::text)),'0');
  end if;
  perform set_config('pilot.popup_recode',new.id::text||' '||new.order_number,true);
  return new;
end; $$;
revoke all on function public.recode_rejected_popup() from public,anon;
create or replace trigger a_recode_rejected_popup before update of popup_plan,status on public.orders
  for each row execute function public.recode_rejected_popup();

-- 5. Immutability: unchanged, except the exact number the recode above produced for that row -------------------------
create or replace function public.shcs_protect_canonical_order_number()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.order_number is distinct from new.order_number then
    if new.order_kind='POPUP' and current_setting('pilot.popup_recode',true)=new.id::text||' '||new.order_number then
      perform set_config('pilot.popup_recode','',true);
      return new;
    end if;
    raise exception 'Order identity is immutable: %', old.order_number using errcode='23514';
  end if;
  return new;
end; $$;
create or replace trigger shcs_protect_canonical_order_number before update of order_number on public.orders
  for each row execute function public.shcs_protect_canonical_order_number();

-- 6. Workflow settings: REJECTED is reserved and never counts as an "in use" editable stage ---------------
create or replace function public.validate_popup_workflow()
returns trigger language plpgsql security invoker set search_path='' as $$
declare stage jsonb; n integer;
begin
  if new.user_id is distinct from auth.uid() then raise exception '팝업 설정 소유권을 확인하세요'; end if;
  if jsonb_typeof(new.popup_workflow) is distinct from 'array' then raise exception '진행 단계 목록을 확인하세요'; end if;
  n:=jsonb_array_length(new.popup_workflow);
  if n not between 2 and 30 or new.popup_workflow->(n-1)->>'id' is distinct from 'COMPLETED' then raise exception '완료 단계를 마지막에 유지하고 2–30개의 단계를 입력하세요'; end if;
  if (select count(distinct v->>'id') from jsonb_array_elements(new.popup_workflow) v)<>n
    or (select count(distinct lower(trim(v->>'label'))) from jsonb_array_elements(new.popup_workflow) v)<>n then raise exception '같은 이름의 진행 단계가 있습니다'; end if;
  for stage in select value from jsonb_array_elements(new.popup_workflow) loop
    if jsonb_typeof(stage->'id') is distinct from 'string' or (stage->>'id') !~ '^[A-Za-z0-9_-]{1,80}$'
      or jsonb_typeof(stage->'label') is distinct from 'string' or length(trim(stage->>'label')) not between 1 and 80 then raise exception '단계 이름은 1–80자로 입력하세요'; end if;
    if stage->>'id'='REJECTED' or upper(trim(stage->>'label'))='REJECTED' then raise exception 'REJECTED는 반려 전용 단계라 추가할 수 없습니다'; end if;
  end loop;
  if tg_op='UPDATE' and exists(select 1 from public.orders o where o.user_id=new.user_id and o.order_kind='POPUP' and nullif(o.popup_plan->>'stage_id','') is not null
    and o.popup_plan->>'stage_id'<>'REJECTED'
    and not exists(select 1 from jsonb_array_elements(new.popup_workflow) stage_row where stage_row->>'id'=o.popup_plan->>'stage_id')) then
    raise exception '사용 중인 단계는 팝업을 다른 단계로 옮긴 뒤 삭제하세요';
  end if;
  if tg_op='UPDATE' and old.popup_workflow is distinct from new.popup_workflow then
    insert into public.order_production_sync_log(user_id,source,before_value,after_value)
      values(new.user_id,'popup_workflow',old.popup_workflow,new.popup_workflow);
  end if;
  return new;
end; $$;
revoke all on function public.validate_popup_workflow() from public,anon;
create or replace trigger validate_popup_workflow before insert or update of popup_workflow,user_id on public.pilot_settings
  for each row execute function public.validate_popup_workflow();

-- 7. Save RPCs: accept REJECTED, and never undo a server recode with the client's stale number ------------
create or replace function public.save_popup_order(p_order_id uuid,p_expected_updated_at timestamptz,p_plan jsonb,p_start timestamptz,p_status text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old_order public.orders%rowtype; saved public.orders%rowtype; i jsonb; profile_id uuid;
begin
  select * into old_order from public.orders where id=p_order_id and user_id=auth.uid() and order_kind='POPUP' for update;
  if not found then raise exception '팝업에 접근할 수 없습니다'; end if;
  if p_expected_updated_at is null or old_order.updated_at<>p_expected_updated_at then raise exception '다른 화면에서 변경되었습니다. 최신 값을 불러오세요'; end if;
  if p_status is null or p_status not in ('INTAKE','CONFIRMED','DESIGN','PRODUCTION','FINAL_TOUCH','DELIVERY','COMPLETED','REJECTED') then raise exception '팝업 상태를 확인하세요'; end if;
  if p_start is not null and not isfinite(p_start) then raise exception '시작 시각을 확인하세요'; end if;
  update public.orders set popup_plan=p_plan,pickup_at=p_start,
    event_date=(p_start at time zone 'Australia/Sydney')::date,status=p_status where id=p_order_id and user_id=auth.uid() returning * into saved;
  for i in select value from jsonb_array_elements(p_plan->'items') loop
    if nullif(i->>'work_session_id','') is not null then
      profile_id:=null;
      if nullif(i->>'product_id','') is not null and nullif(i->>'standard_id','') is not null then
        profile_id:=public.ensure_product_standard_profile((i->>'product_id')::uuid,(i->>'standard_id')::uuid);
      end if;
      update public.work_sessions set product_id=nullif(i->>'product_id','')::uuid,
        product_size_id=profile_id,cake_size_id=nullif(i->>'standard_id','')::uuid,
        target_unit_count=(i->>'quantity')::numeric,scheduled_date=saved.event_date,
        name='POP UP · '||(p_plan->>'title')||' · '||(i->>'label')
        where id=(i->>'work_session_id')::uuid and user_id=auth.uid();
    end if;
  end loop;
  insert into public.order_production_sync_log(user_id,order_id,source,before_value,after_value)
    values(auth.uid(),p_order_id,'popup_plan',to_jsonb(old_order),to_jsonb(saved));
  return to_jsonb(saved);
end; $$;
revoke all on function public.save_popup_order(uuid,timestamptz,jsonb,timestamptz,text) from public,anon;
grant execute on function public.save_popup_order(uuid,timestamptz,jsonb,timestamptz,text) to authenticated;

create or replace function public.save_popup_order_details(p_order_id uuid,p_expected_updated_at timestamptz,p_plan jsonb,p_start timestamptz,p_status text,p_order_number text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved jsonb; renamed public.orders%rowtype; number text:=btrim(p_order_number); before_number text;
begin
  if number is null or length(number)=0 or length(number)>200 then
    raise exception '오더 번호를 1–200자로 입력하세요';
  end if;
  select order_number into before_number from public.orders where id=p_order_id and user_id=auth.uid() and order_kind='POPUP';
  saved:=public.save_popup_order(p_order_id,p_expected_updated_at,p_plan,p_start,p_status);
  -- Rename only when the person typed a different number. A reject/restore recode during the save
  -- changes the number on the server; the client's (older) number must not undo it.
  if number is distinct from before_number and saved->>'order_number' is distinct from number then
    if exists(select 1 from public.orders where user_id=auth.uid() and id<>p_order_id and lower(order_number)=lower(number)) then
      raise exception '이미 사용 중인 오더 번호입니다';
    end if;
    update public.orders set order_number=number where id=p_order_id and user_id=auth.uid() and order_kind='POPUP' returning * into renamed;
    if not found then raise exception '팝업에 접근할 수 없습니다'; end if;
    insert into public.order_production_sync_log(user_id,order_id,source,before_value,after_value)
      values(auth.uid(),p_order_id,'popup_order_number',saved,to_jsonb(renamed));
    saved:=to_jsonb(renamed);
  end if;
  return saved;
end; $$;
revoke all on function public.save_popup_order_details(uuid,timestamptz,jsonb,timestamptz,text,text) from public,anon;
grant execute on function public.save_popup_order_details(uuid,timestamptz,jsonb,timestamptz,text,text) to authenticated;
