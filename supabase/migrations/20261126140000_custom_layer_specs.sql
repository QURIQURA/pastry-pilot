-- 2026-11-26 (Issue #69): 공용 완성 규격 하위 CUSTOM — 규칙 없는 멀티레이어 규격.
-- CUSTOM 규격 1개 = 여러 레이어(단 또는 자유 형태 조각), 레이어마다 자기 컴포넌트 세트(시트+크림+인서트…).
-- 각 컴포넌트 줄은 레시피(포뮬라)와 몰드 × 개수 또는 목표 g를 가진다.
-- 기존 CAKE/FREE 규격·몰드·규격 스펙(size_spec_lines)은 건드리지 않는다. 데이터 삭제/수정 없음.

-- 1) 규격 종류에 CUSTOM 추가 (기존 행은 CAKE/FREE 그대로)
alter table public.cake_sizes drop constraint if exists cake_sizes_kind_check;
alter table public.cake_sizes
  add constraint cake_sizes_kind_check check (kind in ('CAKE', 'FREE', 'CUSTOM'));

-- 2) 레이어: CUSTOM 규격 안의 단/조각. 위치는 sort_order(0 = 바닥).
create table if not exists public.cake_size_layers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  cake_size_id uuid not null references public.cake_sizes(id) on delete cascade,
  sort_order integer not null default 0,
  label text not null default '',
  shape text check (shape is null or shape in ('ROUND', 'SQUARE', 'RECTANGLE', 'FREE')),
  size_inch smallint,
  length_mm numeric check (length_mm is null or length_mm > 0),
  width_mm numeric check (width_mm is null or width_mm > 0),
  height_mm numeric check (height_mm is null or height_mm > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cake_size_layers_size_idx on public.cake_size_layers(cake_size_id);
alter table public.cake_size_layers enable row level security;
drop policy if exists "own cake_size_layers" on public.cake_size_layers;
create policy "own cake_size_layers" on public.cake_size_layers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) 레이어별 컴포넌트 줄: 역할(SHEET/CREAM/INSERT/…) + 레시피 + 몰드 × 개수 또는 목표 g.
create table if not exists public.cake_size_layer_components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  layer_id uuid not null references public.cake_size_layers(id) on delete cascade,
  sort_order integer not null default 0,
  slot text not null default 'SHEET',
  formula_id uuid references public.formulas(id) on delete set null,
  label text not null default '',
  mould_id uuid references public.moulds(id) on delete set null,
  mould_qty numeric not null default 1 check (mould_qty > 0),
  target_g numeric check (target_g is null or target_g >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cake_size_layer_components_layer_idx
  on public.cake_size_layer_components(layer_id);
alter table public.cake_size_layer_components enable row level security;
drop policy if exists "own cake_size_layer_components" on public.cake_size_layer_components;
create policy "own cake_size_layer_components" on public.cake_size_layer_components
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
