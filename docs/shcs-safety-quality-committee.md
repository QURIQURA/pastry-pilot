# SHCS Safety & Quality Committee — Design Board

## Current source of truth
The existing PILOT Supabase project `meswjzwxldhqkjglnmzt` contains a design_moodboards row:
- id: `8459a946-4b03-4da5-aa3b-0e8b0c86f7cb`
- title: `SHCS 사고방지 위원회 · Production & CS Safety`
- kind: `MIND`
- mindmap: 8 nodes, 7 edges, verified 2026-11-20.

This is **not** a request to seed a duplicate board. Ensure the current Design/Mind Board UI lists this existing record; investigate any client-side filters, RLS, cached data, and user scope before modifying anything. Preserve all existing boards and UI.

## INC-001 — 2026-11-20
During chiffon pre-weighing, flour was omitted from the intended oil/flour stage. The missing weight was found by checking the aggregate weights, and flour was added later. Panning height: 6-inch ~6 cm; 8-inch ~7 cm. Final baked heights are **pending**, not failed.

## Quality rule
Measure after baking, cooling and unmoulding. A chiffon with final height <9 cm is not eligible for chiffon cake use. Height >=9 cm is necessary but not sufficient: inspect crumb, bake, texture and safety, especially after mixing deviations. Reclassify failed-height batches as HOLD and consider trifle/other repurposing only if food safety and quality permit. Record both sizes independently.

## Proposed prevention workflow (not yet implemented)
- Separate DAY-1 PRE-WEIGH from DAY-0 PRODUCTION within existing Work Session / formula model.
- One ingredient and one batch active at a time, with visible next step and pause/resume marker.
- Weigh, label, verify each ingredient; bundle by manufacturing stage and batch. Check actual weight and formula version before release.
- Critical oil/flour stage requires explicit confirmation of both ingredients before mixing; total mass alone cannot detect mixing-order errors.
- Record final QC heights, PASS/HOLD/REWORK decisions, stock movement and incident follow-up.
- Later extend the safety program to customer-service incident prevention in SHCS Order, without duplicating its authoritative communications data.

## Integration and acceptance
1. Existing MIND board appears in PILOT Design with the title above and can be opened.
2. No duplicate board is created; existing 13 boards remain intact.
3. Work Session and inventory changes must be designed against actual current schema before implementation.
4. Tests cover board visibility and the chiffon height gate when implemented.
