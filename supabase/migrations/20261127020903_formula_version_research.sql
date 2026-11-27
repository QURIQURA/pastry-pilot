alter table public.formula_versions
  add column if not exists version_title text,
  add column if not exists target_improvement text,
  add column if not exists test_results text,
  add column if not exists observations text,
  add column if not exists next_improvement text;
