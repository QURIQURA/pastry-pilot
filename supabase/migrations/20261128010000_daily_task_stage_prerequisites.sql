-- 2026-11-28 (#98) 데일리 작업도 1차/2차… 작업 단계로 나누고, 선행 작업을 지정한다.
-- 예: Sable bake(데일리)는 2차에 배정된 타르트들보다 먼저 끝나야 한다.
-- 기존 줄은 모두 1차 · 선행 없음이라 지금 화면과 플래너 동기화는 그대로다.
alter table public.daily_tasks
  add column if not exists work_stage smallint not null default 1
    check (work_stage >= 1),
  add column if not exists prerequisite_for uuid[] not null default '{}';

comment on column public.daily_tasks.work_stage is
  '대시보드 작업 단계: 1 = 1차 작업, 2 = 2차 작업 …';
comment on column public.daily_tasks.prerequisite_for is
  '이 데일리 작업이 먼저 끝나야 하는 대상: work_session_formula_versions.id 또는 다른 daily_tasks.id';
