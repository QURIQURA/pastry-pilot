# Planner availability overlay — design proposal (Issue #4)

Status: **PROPOSED**. No implementation or deployment.

## Verified existing sources
- Planner repo `src/lib/use-childcare-sync.ts`: WANN Supabase `public.childcare_schedules` stores per-user `weekly` blocks and date-specific `overrides`; uses RLS, realtime subscription, and localStorage fallback in Planner UI.
- Planner `src/routes/_authenticated/daily.tsx` computes effective childcare responsibility for the selected day by applying overrides to weekly blocks. `Carer` values: `Youn`, `Lach`, `Childcare`, `Shared`, `Unassigned`.
- Pilot Work Session timeline and unscheduled production backlog already exist; preserve them. No verified Pilot availability overlay exists.

## Ownership and semantics
- WANN Planner is the sole writer and source of truth for childcare and personal availability.
- Pilot owns work sessions, production, and task scheduling. Pilot must **never write** childcare schedules.
- Childcare responsibility is **context**, not proof of free time: `Childcare` or `Lach` may suggest a potential work window, but other Planner tasks or appointments can block it. `Unassigned` is **unknown**, not free.
- Do not infer availability from childcare alone or automatically move Work Sessions.

## Suggested contract
- A server-side WANN endpoint/RPC (authenticated, least privilege) returns *derived* blocks for an explicit date range, scoped to the authorized Planner user. Avoid exposing `childcare_schedules` directly to the SHCS client or copying its full JSON into Pilot tables.
- Proposed response: `{ date, start, end, timezone: 'Australia/Sydney', category: 'care_responsibility', label, source: 'wann-planner', updated_at }`. Future availability/busy blocks should use an explicit, independently defined contract and permissions.
- Identity mapping between SHCS user and WANN user must be reviewed and authorized before implementation. Do not hardcode user IDs or expose service-role keys to browser.
- For missing authorization, stale data, network failures or unknown care assignment, show `Unavailable / not synced`, not an empty/free schedule.

## UI behavior
- Reuse existing Pilot Work Session timeline scale and grid; render a subtle non-interactive background overlay behind production sessions (toggle `Show Planner context`). No second timeline or editable childcare UI.
- Tooltip: source, time range, carer, and last synced. Never label a childcare block `Available` unless an actual availability policy is explicitly approved.
- Keep unscheduled production backlog, Work Session drag/drop, and production capacity logic unchanged.
- Date overrides take precedence over weekly rules; handle partial overlaps, daylight saving and Sydney local date boundaries.

## Implementation gates
1. Inspect current Pilot timeline source and auth architecture, plus WANN RLS and cross-project identity mapping.
2. Confirm whether scope is childcare-only context or full Planner availability (tasks/appointments too).
3. Review and approve minimal endpoint/auth contract and UX.
4. Implement in feature branch with Draft PR, tests for overrides/timezone/failure cases.
5. Explicit approval before merge/deploy; end-to-end verify with live data.
