import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./load-ts.mjs";

const { filterFormulaCandidates, hasLatestVersionDietaryTag } = await loadTs(
  "src/lib/formula-picker.ts",
);
const techniques = [
  { id: "pastry", slot_group: "SHEET" },
  { id: "sponge", parent_id: "pastry", slot_group: null },
  { id: "cream", slot_group: "CREAM" },
  { id: "fruit", slot_group: "FILLING" },
];
const formulas = [
  { id: "1", name: "Vanilla Chiffon", technique_category_id: "sponge" },
  { id: "2", name: "Vanilla Chantilly", technique_category_id: "cream" },
  { id: "3", name: "Lemon Curd", technique_category_id: "fruit" },
  { id: "4", name: "Legacy Recipe", technique_category_id: null },
  {
    id: "5",
    name: "Greek Yogurt Cream",
    technique_category_id: null,
    components: { technique_category_id: "cream" },
  },
];
const ids = (slot, selected = "", search = "", scope = "compatible") =>
  filterFormulaCandidates(formulas, techniques, slot, selected, search, scope).map((row) => row.id);

test("uses inherited and component technique groups with the existing insert/filling convention", () => {
  assert.deepEqual(ids("SHEET"), ["1"]);
  assert.deepEqual(ids("CREAM"), ["5", "2"]);
  assert.deepEqual(ids("FILLING"), ["3"]);
  assert.deepEqual(ids("INSERT"), ["3"]);
  assert.equal(ids("COOKIE").length, formulas.length);
});

test("keeps the linked formula visible through role and text filters", () => {
  assert.deepEqual(ids("SHEET", "2", "no match"), ["2"]);
  assert.deepEqual(ids("SHEET", "", " vanilla ", "all"), ["2", "1"]);
  assert.deepEqual(ids("SHEET", "", "legacy", "unclassified"), ["4"]);
});

test("a dietary tag on an earlier version does not qualify the newest version", () => {
  const versions = [
    { id: "new", version_number: 2 },
    { id: "old", version_number: 1 },
  ];
  assert.equal(
    hasLatestVersionDietaryTag(
      versions,
      [{ formula_version_id: "old", dietary_tag_id: "df" }],
      "df",
    ),
    false,
  );
  assert.equal(
    hasLatestVersionDietaryTag(
      versions,
      [{ formula_version_id: "new", dietary_tag_id: "df" }],
      "df",
    ),
    true,
  );
});
