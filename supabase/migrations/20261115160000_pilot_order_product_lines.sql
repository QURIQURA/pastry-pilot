-- Per-user order product lines. Keys remain stable for existing order/planner links.
alter table public.pilot_settings
  add column if not exists product_lines jsonb;

comment on column public.pilot_settings.product_lines is
  'Order product lines [{key,label,active}]. Keys are immutable and used by planner sync.';
