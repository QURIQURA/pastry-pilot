import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const { buildWeighingGroups } = await loadTs("src/lib/work-session.ts", {
  "@/integrations/supabase/client": "export const supabase = {};",
  "@/lib/formula": "export const toGrams = (value) => value;",
  "@/lib/datetime": "export const generateTitle = () => '';",
  "@/lib/pilot": "export const ingredientDisplayName = (item) => item?.name ?? '—';",
});
const line = (id, ingredient_id, amount, sort_order, note) => ({
  id, ingredient_id, amount, sort_order, note, unit: "g",
  ingredients: { name: ingredient_id },
  secondary_amount: null, secondary_unit: null,
});
const creamLines = [
  line("hot", "cream", 150, 1, "가열용"),
  line("cold", "cream", 225, 2, "냉장용"),
  line("other", "sugar", 40, 3, null),
];
const selections = [
  { selectionId: "sh-0020", formulaVersionId: "v2", formulaName: "Cream V2", multiplier: 960/1050, sortOrder: 1 },
  { selectionId: "snd-003", formulaVersionId: "v2", formulaName: "Cream V2", multiplier: 700/1050, sortOrder: 2 },
];
test("Work View keeps hot and chilled cream as separate rows in merged V2 columns", () => {
  const groups = buildWeighingGroups({
    selections, ingredientsByVersion: { v2: creamLines },
    progressBySelectionAndLine: { "sh-0020:hot": { status: "DONE", note: "warmed" } },
  });
  const creams = groups.filter((g) => g.ingredientId === "cream");
  assert.equal(creams.length, 2);
  assert.equal(new Set(creams.map((g) => g.rowKey)).size, 2);
  assert.deepEqual(creams.map((g) => g.cells[0].ingredientLineId), ["hot", "cold"]);
  assert.deepEqual(creams.map((g) => g.cells[0].lineNote), ["가열용", "냉장용"]);
  assert.ok(creams.every((g) => g.cells.length === 2));
  assert.equal(creams[0].cells[0].progressStatus, "DONE");
  assert.equal(creams[1].cells[0].progressStatus, "NOT_STARTED");
  assert.equal(groups.flatMap((g) => g.cells).length, 6);
  assert.ok(Math.abs(
    groups.flatMap((g) => g.cells).reduce((sum, c) => sum + c.workingAmount, 0)
    - 1660/1050 * (150+225+40),
  ) < 0.00001);
});

test("Work View does not drop repeated ingredient without notes", () => {
  const rows = [line("a", "egg", 70, 0, null), line("b", "egg", 30, 1, null)];
  const groups = buildWeighingGroups({
    selections: [selections[0]],
    ingredientsByVersion: { v2: rows },
    progressBySelectionAndLine: {},
  });
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.cells[0].ingredientLineId), ["a", "b"]);
  assert.equal(groups.reduce((n, g) => n + g.cells[0].amount, 0), 100);
});
