import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";
const { applySavedQuantities, equalMouldSplit, matchesMouldSplit, roundIngredientGrams, groupProductionSelections, rescaleProductionSelections } =
  await loadTs("src/lib/production-quantity.ts");
test("MERGED ×4 publishes confirmed quantities to both rows and weighing data before refetch", () => {
  const cached = [
    { id: "a", formula_version_id: "v2", multiplier: 1, updated_at: "old-a", sessionId: "order-a" },
    { id: "b", formula_version_id: "v2", multiplier: 1, updated_at: "old-b", sessionId: "order-b" },
    {
      id: "c",
      formula_version_id: "other",
      multiplier: 3,
      updated_at: "old-c",
      sessionId: "order-c",
    },
  ];
  const plan = rescaleProductionSelections(cached.slice(0, 2), 4);
  const response = plan.map(({ row, multiplier }) => ({
    id: row.id,
    multiplier,
    updated_at: "server-time",
  }));
  const selectionCache = applySavedQuantities(cached, response);
  const dashboardCache = applySavedQuantities(
    cached.map((r) => ({ id: r.id, multiplier: r.multiplier })),
    response,
  );
  assert.equal(groupProductionSelections(selectionCache, new Set(["v2"]))[0].multiplier, 4);
  assert.equal(selectionCache[0].updated_at, "server-time");
  assert.equal(dashboardCache[0].multiplier + dashboardCache[1].multiplier, 4);
  assert.equal(
    342.5 * groupProductionSelections(selectionCache, new Set(["v2"]))[0].multiplier,
    1370,
  );
  assert.equal(selectionCache[2], cached[2]);
  assert.equal(cached[0].multiplier, 1);
  assert.equal(applySavedQuantities(undefined, response), undefined);
});
const rows = [
  {
    id: "sandwich",
    formula_version_id: "cream-v1",
    multiplier: 2,
    slot: "CREAM",
    sessionId: "order-a",
  },
  {
    id: "sheet",
    formula_version_id: "sheet-v1",
    multiplier: 1,
    slot: "SHEET",
    sessionId: "order-a",
  },
  {
    id: "icing",
    formula_version_id: "cream-v1",
    multiplier: 1,
    slot: "FILLING",
    sessionId: "order-b",
  },
  {
    id: "new-recipe",
    formula_version_id: "cream-v2",
    multiplier: 4,
    slot: "CREAM",
    sessionId: "order-c",
  },
];
test("separate by selection until explicitly merged", () => {
  assert.deepEqual(
    groupProductionSelections(rows, new Set()).map((g) => g.multiplier),
    [2, 1, 1, 4],
  );
});
test("same version across orders/slots merges in first-occurrence order, preserving source IDs", () => {
  const before = structuredClone(rows);
  const groups = groupProductionSelections(rows, new Set(["cream-v1"]));
  assert.deepEqual(
    groups.map((g) => g.multiplier),
    [3, 1, 4],
  );
  assert.deepEqual(
    groups[0].members.map((m) => m.id),
    ["sandwich", "icing"],
  );
  assert.deepEqual(rows, before);
});
test("split timeline blocks cannot double quantity", () => {
  const groups = groupProductionSelections([...rows, rows[0]], new Set(["cream-v1"]));
  assert.equal(groups[0].multiplier, 3);
});
test("UNMERGE restores the individual selections with no recipe/progress mutations", () => {
  groupProductionSelections(rows, new Set(["cream-v1"]));
  assert.equal(groupProductionSelections(rows, new Set()).length, 4);
});
test("aggregate target scales original order allocations proportionally", () => {
  const plan = rescaleProductionSelections([rows[0], rows[2]], 6);
  assert.deepEqual(
    plan.map((p) => p.multiplier),
    [4, 2],
  );
  assert.equal(rows[0].multiplier, 2);
});
test("fractional target is conserved", () => {
  const plan = rescaleProductionSelections([rows[0], rows[2]], 1.23456789);
  assert.equal(
    plan.reduce((n, p) => n + p.multiplier, 0),
    1.23456789,
  );
});
test("reject invalid quantities and different versions", () => {
  for (const n of [0, -1, NaN, Infinity])
    assert.throws(() => rescaleProductionSelections([rows[0]], n));
  assert.throws(() => rescaleProductionSelections([rows[0], rows[3]], 1));
  assert.throws(() => rescaleProductionSelections([rows[0], rows[0]], 1));
  assert.throws(() => rescaleProductionSelections([], 1));
});

test("whole-gram split retains every gram and validates independently for each source order", () => {
  assert.deepEqual(equalMouldSplit(1361, 2), [681, 680]);
  assert.deepEqual(equalMouldSplit(1360, 2), [680, 680]);
  assert.equal(matchesMouldSplit([700, 660], 2, 1360), true);
  assert.equal(matchesMouldSplit([700, 659], 2, 1360), false);
  assert.equal(matchesMouldSplit([1360], 2, 1360), false);
  assert.deepEqual(equalMouldSplit(1360, 1.5), []);
});

test("displayed ingredient grams add up to the displayed whole batch", () => {
  const lines = [{ id: "egg", grams: 200.36 }, { id: "flour", grams: 101.45 }];
  assert.deepEqual([...roundIngredientGrams(lines)], [["flour", 102], ["egg", 200]]);
  assert.equal([...roundIngredientGrams(lines).values()].reduce((sum, grams) => sum + grams, 0), 302);
});
