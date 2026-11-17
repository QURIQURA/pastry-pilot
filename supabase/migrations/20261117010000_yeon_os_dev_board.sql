-- YEON OS Development Board (pastry-pilot#17), 2026-11-17.
-- PILOT hosts the *view* of software work across SHCS / PILOT / Planner. GitHub stays the source of
-- truth for issues, PRs and code; these tables only hold board records, links to GitHub and a cached,
-- read-only snapshot of GitHub state. Nothing here touches SHCS or Planner data.
-- Additive only. Rollback: supabase/rollback/20261117010000_yeon_os_dev_board_down.sql.
-- Do not put customer PII or secrets in these text fields.

-- 1) Work items -------------------------------------------------------------------------------
create table if not exists public.dev_work_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  work_key text not null,                         -- human id, e.g. YOS-001 (unique per owner)
  title text not null,
  goal text,                                      -- goal / problem
  expected_outcome text,
  actual_result text,
  owning_os text not null default 'PILOT'
    check (owning_os in ('SHCS','PILOT','PLANNER','SHARED')),
  affected_os text[] not null default '{}'
    check (affected_os <@ array['SHCS','PILOT','PLANNER','SHARED']::text[]),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED','SPECIFIED','IMPLEMENTING','PR_OPEN','REVIEWING','MERGED',
                      'DEPLOYED','VERIFIED','BLOCKED','FAILED')),
  priority text not null default 'P2' check (priority in ('P0','P1','P2','P3')),
  tests text,
  deployment text,
  runtime_verification text,
  blocker text,
  rationale text,
  scope text,
  acceptance_criteria text,
  implementation_notes text,
  verification_evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dev_work_items_key_unique unique (user_id, work_key)
);
create index if not exists dev_work_items_user_status_idx on public.dev_work_items(user_id, status);

-- 2) Relationships (graph edges) ----------------------------------------------------------------
create table if not exists public.dev_work_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  from_id uuid not null references public.dev_work_items(id) on delete cascade,
  to_id uuid not null references public.dev_work_items(id) on delete cascade,
  kind text not null default 'RELATED' check (kind in ('DEPENDS_ON','RELATED','BLOCKS','PART_OF')),
  created_at timestamptz not null default now(),
  constraint dev_work_relations_not_self check (from_id <> to_id),
  constraint dev_work_relations_unique unique (from_id, to_id, kind)
);
create index if not exists dev_work_relations_to_idx on public.dev_work_relations(to_id);

-- 3) External refs (GitHub issues / PRs / docs). sync_key is the idempotent key used by the sync.
create table if not exists public.dev_work_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  work_item_id uuid not null references public.dev_work_items(id) on delete cascade,
  kind text not null check (kind in ('ISSUE','PR','DOC','OTHER')),
  repo text,                                      -- owner/name for GitHub refs
  number integer check (number is null or number > 0),
  url text not null check (url ~ '^https://'),
  sync_key text not null,                         -- github:owner/name#123 or url:<url>
  title text,
  gh_state text,                                  -- open / closed (cached from GitHub)
  gh_draft boolean,
  gh_merged_at timestamptz,
  gh_labels text[] not null default '{}',
  gh_updated_at timestamptz,
  synced_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now(),
  constraint dev_work_refs_unique unique (work_item_id, sync_key)
);
create index if not exists dev_work_refs_user_key_idx on public.dev_work_refs(user_id, sync_key);

-- 4) Status events (changelog) — written by trigger only.
create table if not exists public.dev_work_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  work_item_id uuid not null references public.dev_work_items(id) on delete cascade,
  from_status text,
  to_status text not null,
  created_at timestamptz not null default now()
);
create index if not exists dev_work_events_item_idx on public.dev_work_events(work_item_id, created_at);

-- RLS: owner only, no anon access ---------------------------------------------------------------
alter table public.dev_work_items enable row level security;
alter table public.dev_work_relations enable row level security;
alter table public.dev_work_refs enable row level security;
alter table public.dev_work_events enable row level security;
revoke all on public.dev_work_items, public.dev_work_relations, public.dev_work_refs,
  public.dev_work_events from anon;
grant select, insert, update, delete on public.dev_work_items, public.dev_work_relations,
  public.dev_work_refs to authenticated;
grant select on public.dev_work_events to authenticated;

drop policy if exists "own dev_work_items" on public.dev_work_items;
create policy "own dev_work_items" on public.dev_work_items for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Both endpoints must belong to the caller, so nobody can link into someone else's items.
drop policy if exists "own dev_work_relations" on public.dev_work_relations;
create policy "own dev_work_relations" on public.dev_work_relations for all to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.dev_work_items i where i.id = from_id and i.user_id = auth.uid())
    and exists (select 1 from public.dev_work_items i where i.id = to_id and i.user_id = auth.uid())
  );

drop policy if exists "own dev_work_refs" on public.dev_work_refs;
create policy "own dev_work_refs" on public.dev_work_refs for all to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.dev_work_items i where i.id = work_item_id and i.user_id = auth.uid())
  );

drop policy if exists "read own dev_work_events" on public.dev_work_events;
create policy "read own dev_work_events" on public.dev_work_events for select to authenticated
  using (auth.uid() = user_id);

-- Triggers ---------------------------------------------------------------------------------------
drop trigger if exists update_dev_work_items_updated_at on public.dev_work_items;
create trigger update_dev_work_items_updated_at before update on public.dev_work_items
  for each row execute function public.update_updated_at_column();

-- SECURITY DEFINER so the event row can be written although clients have no insert grant;
-- it only copies the row's own user_id and statuses.
create or replace function public.dev_work_log_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.dev_work_events(user_id, work_item_id, from_status, to_status)
    values (new.user_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status);
  end if;
  return new;
end $$;
revoke all on function public.dev_work_log_status() from public, anon, authenticated;

drop trigger if exists dev_work_items_log_status on public.dev_work_items;
create trigger dev_work_items_log_status after insert or update of status on public.dev_work_items
  for each row execute function public.dev_work_log_status();

-- Seed the two initial efforts for the PILOT owner (idempotent; skipped if that user is absent).
do $$
declare
  owner uuid := '53e168e4-72aa-418e-812a-6caaf315a205';
  board uuid; auto uuid; deploy uuid;
begin
  if not exists (select 1 from auth.users where id = owner) then return; end if;

  insert into public.dev_work_items(user_id, work_key, title, goal, expected_outcome, owning_os,
      affected_os, status, priority, scope)
    values (owner, 'YOS-001', 'YEON OS Development Board',
      'Track software changes across SHCS, PILOT and Planner in one view without a second source of truth.',
      'Table, Kanban and graph views of the same work records, linked to GitHub issues and PRs.',
      'PILOT', array['SHCS','PILOT','PLANNER'], 'PR_OPEN', 'P1',
      'PILOT hosts the view; GitHub stays the source of truth.')
    on conflict (user_id, work_key) do nothing;
  insert into public.dev_work_items(user_id, work_key, title, goal, expected_outcome, owning_os,
      affected_os, status, priority, scope)
    values (owner, 'YOS-002', 'YEON OS Auto-Pilot (Issue → Claude Code → Draft PR)',
      'Start Claude Code from a labelled GitHub issue and get a draft PR with tests and review, without copying prompts.',
      'Bounded, least-privilege GitHub Actions workflow; unsafe changes stay blocked for manual review.',
      'SHARED', array['SHCS','PILOT','PLANNER'], 'IMPLEMENTING', 'P1',
      'Pilot first in pastry-pilot, then shcs-order and wann-planner.')
    on conflict (user_id, work_key) do nothing;

  insert into public.dev_work_items(user_id, work_key, title, goal, expected_outcome, owning_os,
      affected_os, status, priority, scope)
    values (owner, 'YOS-003', 'Auto-Pilot deploy automation (migrations, functions, risk-based merge)',
      'After one-time setup, only feature requests and important approvals need the owner.',
      'Migrations and PILOT edge functions deploy from CI; high-risk changes wait for approval; results land on this board.',
      'SHARED', array['SHCS','PILOT','PLANNER'], 'PR_OPEN', 'P1',
      'pastry-pilot first; shcs-order and wann-planner after a dry run.')
    on conflict (user_id, work_key) do nothing;

  select id into board from public.dev_work_items where user_id = owner and work_key = 'YOS-001';
  select id into deploy from public.dev_work_items where user_id = owner and work_key = 'YOS-003';
  select id into auto from public.dev_work_items where user_id = owner and work_key = 'YOS-002';

  insert into public.dev_work_refs(user_id, work_item_id, kind, repo, number, url, sync_key)
    values
      (owner, board, 'ISSUE', 'QURIQURA/pastry-pilot', 17,
        'https://github.com/QURIQURA/pastry-pilot/issues/17', 'github:QURIQURA/pastry-pilot#17'),
      (owner, auto, 'ISSUE', 'QURIQURA/pastry-pilot', 18,
        'https://github.com/QURIQURA/pastry-pilot/issues/18', 'github:QURIQURA/pastry-pilot#18'),
      (owner, deploy, 'ISSUE', 'QURIQURA/pastry-pilot', 20,
        'https://github.com/QURIQURA/pastry-pilot/issues/20', 'github:QURIQURA/pastry-pilot#20'),
      (owner, board, 'PR', 'QURIQURA/pastry-pilot', 19,
        'https://github.com/QURIQURA/pastry-pilot/pull/19', 'github:QURIQURA/pastry-pilot#19'),
      (owner, auto, 'PR', 'QURIQURA/pastry-pilot', 19,
        'https://github.com/QURIQURA/pastry-pilot/pull/19', 'github:QURIQURA/pastry-pilot#19'),
      (owner, deploy, 'PR', 'QURIQURA/pastry-pilot', 19,
        'https://github.com/QURIQURA/pastry-pilot/pull/19', 'github:QURIQURA/pastry-pilot#19')
    on conflict (work_item_id, sync_key) do nothing;

  insert into public.dev_work_relations(user_id, from_id, to_id, kind)
    values (owner, auto, board, 'RELATED'), (owner, deploy, auto, 'PART_OF')
    on conflict (from_id, to_id, kind) do nothing;
end $$;
