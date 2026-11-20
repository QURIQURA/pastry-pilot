# Issue #63 — Planner Shopping List in PILOT Work Session

## Source of truth
Wann Planner owns `public.planner_tasks` (`is_shopping=true`) and `public.planner_task_completions`. PILOT must not create a shopping table or copy shopping records.

## Actual inspected code
- Planner: `src/components/wann/ShoppingListWidget.tsx` and `src/lib/wann-data.ts`; shopping items are Planner tasks with `is_shopping`, `due_date`, `shopping_type`, `shopping_order`, `completed`, `recurrence`. Recurring completions use `planner_task_completions`.
- PILOT: `src/components/pilot/ProductionDashboard.tsx` is the production Work Session dashboard; existing edge `planner-availability` already uses the WANN service-role secret and authenticates PILOT owner.
- WANN Supabase `txrxzsrjqwhvjosutotp`: `integration_links` has one `source='pilot'` row pointing to Planner user ID. Pilot/SHCS Supabase is `meswjzwxldhqkjglnmzt`.

## Implementation
- `supabase/functions/planner-shopping/index.ts`: PILOT owner JWT authentication; WANN service key server-side; Planner user mapped by `integration_links`; list/add/toggle with Planner-authoritative writes.
- `src/components/pilot/PlannerShoppingPanel.tsx`: compact bottom section, quick add, list and completion, 15-second refresh plus focus/manual refresh. No shadow storage.
- `src/components/pilot/ProductionDashboard.tsx`: panel mounted at bottom after session notes.
- `supabase/config.toml`: function `verify_jwt=false` consistent with PILOT's existing function auth (function performs its own strict owner validation).

## Acceptance and deployment
1. PR build, system tests, lint, SQL tests green.
2. Deploy `planner-shopping` function to SHCS/PILOT Supabase; verify deployed and secrets configured.
3. Merge PR and verify Cloudflare Workers `quriqura-kora-pilot` deployment.
4. Authenticated browser: Planner list appears in PILOT; quick add appears in Planner; completing from either UI reflects on the other within 15 seconds; recurring tasks preserve per-occurrence completion; non-owner access denied.
5. Check logs for 401/503/502 and avoid leaking keys or private shopping items.

## Limitations
- Polling is every 15 seconds, not a database replication or instant push channel.
- Existing WANN shopping items beyond the first 500 are not displayed; API returns an explicit error only for upstream failures.
- Production UI and cross-app write verification must be recorded with actual evidence before DONE.
