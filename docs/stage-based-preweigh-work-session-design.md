# PILOT Stage-based Pre-Weigh — Work Session Integration (2026-11-20)

Status: **design approved for stage-based kits; not yet implemented in production UI**.

## Principle
Separate DAY-1 PRE-WEIGH and DAY-0 PRODUCTION, without duplicating Formula, Work Session, or Production Record authority. A kit represents ingredients individually weighed, labelled, and grouped for one manufacturing stage of one batch. **Do not pre-mix ingredients merely because they share a kit**.

## Verified existing database entities
- `work_sessions`: id, user_id, order_id, product_id, product_size_id, scheduled_date, status.
- `work_session_tasks`: id, work_session_id, formula_version_id, task_name, task_type, predecessor_task_id, status, checklist_items jsonb, observation_height_*_mm, batter_height_mm, actual_started_at, completed_at.
- `work_session_task_ingredients`: id, work_session_id, task_id, formula_version_ingredient_id.
- `formulas` and `product_components` already exist.
No dedicated persisted actual ingredient weight or kit release record was found in these three inspected Work Session tables.

## Data model proposal (migration required, not applied)
- `preweigh_kits`: id, user_id, work_session_id, production_task_id, formula_version_id, batch_key, stage_key, stage_label, target_production_at, planned_weigh_at, status [PLANNED, WEIGHING, VERIFYING, READY, RELEASED, HOLD, CANCELLED], storage_type, storage_location, label_code, verified_at, released_at, created_at, updated_at.
- `preweigh_kit_items`: id, kit_id, formula_version_ingredient_id, target_weight_g, actual_weight_g, weighed_at, verified_at, status [PENDING, WEIGHED, VERIFIED, HOLD], container_label, storage_instructions, notes.
- `preweigh_events`: id, kit_id, kit_item_id nullable, event_type, actor_user_id, created_at, note, previous_value jsonb, new_value jsonb. Immutable audit trail.
- Ensure user_id ownership/RLS, uniqueness per (work_session_id, batch_key, stage_key, formula_version_id) and stable item identity, indexes on production_task_id and planned_weigh_at. Formula snapshot/version pinning required.

## Stage kit generation
1. Start from an existing production work session, selected formula version, adjusted quantity, mould allocation and batch identity.
2. Resolve formula ingredients to manufacturing stages (e.g. CHIFFON: DRY, OIL, YOLK, MERINGUE). Preserve recipe method ordering; never guess a stage for unknown ingredients. Unmapped ingredients are explicitly UNASSIGNED and block READY.
3. Create per-stage kits, with each ingredient separately weighed and labelled. Do not merge ingredients across batches by default.
4. Weigh one ingredient at a time, capture actual weight, confirm label, then mark verified. Display target and actual weight plus tolerance; tolerance must be recipe-appropriate and configurable, not a universal arbitrary percentage.
5. If interrupted, persist next ingredient and current state. On resume re-check any open/unverified container.
6. READY only if every required ingredient is verified, formula/version unchanged, storage conditions satisfied, no HOLD or unresolved item. A kit can be released to production only once; correction requires an auditable event.
7. Production task reads linked kit status; unresolved kit requires explicit exception workflow with reason and verification rather than silently proceeding.
8. After production, record kit usage and QC against existing production tasks, including final cooled/unmoulded chiffon height per mould. Chiffon <90 mm = HOLD / not eligible as chiffon cake; >=90 mm still requires texture, bake and safety checks. Repurposing requires quality and food-safety release.

## Example: chiffon oil-stage kit
Kit CHIF-B01-OIL: separately labelled OIL and FLOUR containers (plus other formula-specific ingredients); critical two-item check before mixing. This is a manufacturing-stage grouping, not an instruction to mix oil and flour the night before.

## UI
Existing Work Session page: add compact PRE-WEIGH section before production timeline, showing grouped stage kits, status, planned date, per-ingredient target/actual, label and storage, progress, hold reason, and one-click jump to the related production task. Show READY/HOLD prominently; do not create a duplicate Work Session dashboard.
Existing Planner integration: pre-weigh tasks are scheduled independently of production, subject to availability rules already owned by Planner. Do not duplicate Planner's childcare/time logic.
Existing Design Board: committee board id `8459a946-4b03-4da5-aa3b-0e8b0c86f7cb` is the incident/prevention planning surface, not the operational ledger.

## Implementation acceptance criteria
- Kit creation is idempotent, batch/version scoped, and safe with merged production orders.
- Missing flour cannot yield READY; checking only total weight is insufficient.
- Pausing and resuming retains exact next action.
- A modified formula/version invalidates stale READY kits and requests re-verification.
- Partial weigh, duplicate clicks, concurrency, invalid measurements, HOLD and correction are covered by tests.
- Existing orders, tasks, work view, production records and Planner integration remain intact.
- Verify migration, UI, automated tests and Lovable deployment separately; do not claim deployment from a docs-only commit.
