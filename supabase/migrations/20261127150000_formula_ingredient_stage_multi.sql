-- 2026-11-27 (#94) 여러 단계 포뮬라: 재료 단계를 2차까지에서 9차까지로 넓힌다(3차, 4차… 추가).
-- 제약 조건만 바꾸고 데이터는 그대로다.
alter table public.formula_version_ingredients
  drop constraint if exists formula_version_ingredients_stage_check;
alter table public.formula_version_ingredients
  add constraint formula_version_ingredients_stage_check check (stage between 1 and 9);

comment on column public.formula_version_ingredients.stage is
  '재료를 넣는 단계: 1 = 처음부터, 2·3·4… = 나중 단계(N차). 계량 표에서 단계별로 확인한다.';
