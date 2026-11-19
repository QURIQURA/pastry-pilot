# YEON OS — Order identity contract (2026-11-19)

## Decision (for Claude, Lovable, Codex and future maintainers)

- `public.orders.id` (UUID) is the immutable database identity. Never regenerate it.
- `SH-0001`, `SH-0002`, ... are the canonical **cake order** serial numbers in PILOT. Each cake order receives exactly one SH; the serial is global across weeks and must never use decimal suffixes.
- `ORD-0001` is an SHCS **manual/direct intake reference**, not a second cake order.
- `REQ-0001` is an SHCS **website intake reference**, not a second cake order.
- `SND-001` is a Saturday Night Dessert **popup event/project**. It is not a cake order, and must not consume SH numbers.
- A popup can sell cakes registered as ORD or REQ: link those individual cake orders to the SND event. Walk-up pastries/slices/profiteroles are separate popup sales transactions/line items, not SH orders.
- Order counts must count distinct canonical cake-order UUIDs, not SHCS requests, event projects, or popup product quantities.
- Never sum PILOT order prices and linked SHCS request prices together; reconcile them as one sale. Paid revenue needs payment evidence.

## Historical records

- Old `SH-010.2` numbers encoded week + sale index. They are legacy identifiers only. Their suffixes should not be shown as current canonical SH numbers, but original strings MUST be preserved in an auditable legacy-reference column/table for traceability.
- Old PILOT `ORD-0001` etc were created by SHCS manual sync. Give these records canonical SH numbers while retaining their ORD intake references. Preserve existing UUID, customer, production, Planner, and request links.
- Do not guess that the original week number or decimal suffix determines chronological sale order.
- `SND-001` on 2026-11-14 has two likely cake orders (`ORD-0002` and `ORD-0003`, each $70). Confirm their association and payment before adding $140 to popup realized revenue.

## Implementation contract

1. Inspect *live* PostgreSQL trigger definitions and SHCS order-sync functions, not just historical migration files.
2. Inventory ALL existing SH/ORD/SND records, duplicates, UUID links and references before renumbering.
3. Back up legacy number mappings and implement atomic, concurrency-safe SH allocation (sequence).
4. Ensure SHCS manual sync does not insert `request_number` into `orders.order_number`; web request sync must continue to link by UUID.
5. Preserve SND popup numbering; add explicit event-to-cake-order relationship, without confusing popup event with sale transaction.
6. Update PILOT Orders list/detail, SHCS admin/archive, CHRONICLE reconciliation and all exports/calendars/search to show canonical SH plus intake reference.
7. Verify create flows for PILOT direct, SHCS manual ORD, SHCS web REQ, popup SND, and popup cake ORD; test duplicate/retry/idempotency and historical links.
8. Never deploy an untested destructive renumbering or silently change historical data.

## Deployment status

This document and the dashboard widget are informational. They do NOT imply the database migration is deployed. Track schema deployment separately.
