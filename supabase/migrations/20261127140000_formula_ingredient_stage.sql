-- 2026-11-27 (#92) 두 단계 포뮬라: 나중에 넣는 재료(2차) 표시.
-- 예: White Chocolate Cream Cheese Chantilly — 가나슈(화이트 커버춰, 생크림…)를 먼저 만들고
-- 몇 시간 뒤 크림치즈를 섞는다. 기존 줄은 모두 1(처음부터)이라 지금 화면과 계산은 그대로다.
alter table public.formula_version_ingredients
  add column if not exists stage smallint not null default 1
  check (stage between 1 and 2);

comment on column public.formula_version_ingredients.stage is
  '1 = 처음부터 넣는 재료, 2 = 나중 단계(2차)에 넣는 재료. 계량 표에서 2차 계량을 따로 확인한다.';

-- R&D 실험 버전을 만들 때도 2차 표시를 같이 복사한다(나머지는 20261106140000과 동일).
-- 실험 시작: 기준 버전을 복사한 DRAFT 버전과 실험 행을 만든다.
create or replace function public.start_formula_experiment(
  p_formula_id uuid, p_base_version_id uuid, p_title text, p_hypothesis text default null)
returns uuid language plpgsql set search_path = '' as $$
declare uid uuid := auth.uid(); base public.formula_versions; new_version uuid; exp_id uuid; next_no int;
begin
  if uid is null then raise exception '로그인이 필요합니다'; end if;
  if nullif(btrim(p_title), '') is null then raise exception '실험 이름을 입력하세요'; end if;
  select * into base from public.formula_versions
    where id = p_base_version_id and formula_id = p_formula_id and user_id = uid;
  if not found then raise exception '기준 버전을 찾을 수 없습니다'; end if;
  select coalesce(max(version_number), 0) + 1 into next_no
    from public.formula_versions where formula_id = p_formula_id;
  insert into public.formula_versions(user_id, formula_id, version_number, status, default_mould_id,
      default_base_weight_id, default_capacity_id, yield_quantity, component_sources, notes,
      change_summary, change_reason, bath_water_g, basis_overrides)
    values (uid, p_formula_id, next_no, 'DRAFT', base.default_mould_id, base.default_base_weight_id,
      base.default_capacity_id, base.yield_quantity, base.component_sources, base.notes,
      'R&D: ' || btrim(p_title), nullif(btrim(coalesce(p_hypothesis, '')), ''), base.bath_water_g,
      base.basis_overrides)
    returning id into new_version;
  insert into public.formula_version_ingredients(user_id, formula_version_id, ingredient_id, amount, unit,
      sort_order, note, secondary_amount, secondary_unit, stage, amount_source)
    select uid, new_version, ingredient_id, amount, unit, sort_order, note, secondary_amount,
      secondary_unit, stage, 'copied'
    from public.formula_version_ingredients where formula_version_id = base.id;
  insert into public.formula_experiments(user_id, formula_id, base_version_id, version_id, title, hypothesis)
    values (uid, p_formula_id, base.id, new_version, btrim(p_title), nullif(btrim(coalesce(p_hypothesis, '')), ''))
    returning id into exp_id;
  return exp_id;
end; $$;
