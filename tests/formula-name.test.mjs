import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./load-ts.mjs";

const { canonicalFormulaName, readCanonicalFormulaName } = await loadTs("src/lib/formula-name.ts");

test("round trips compound terms and selected texture", () => {
  const name = canonicalFormulaName(" Lemon & Cream Cheese ", "Medium", "Ganache Chantilly");
  assert.equal(name, "Lemon & Cream Cheese · Medium · Ganache Chantilly");
  assert.deepEqual(readCanonicalFormulaName(name), {
    flavour: "Lemon & Cream Cheese",
    texture: "Medium",
    productType: "Ganache Chantilly",
  });
});

test("rejects version and dietary markers and does not infer legacy texture", () => {
  assert.equal(canonicalFormulaName("GF Vanilla", "Soft", "Chantilly"), "");
  assert.equal(canonicalFormulaName("Vanilla", "Soft", "Chantilly V2"), "");
  assert.equal(canonicalFormulaName("Vanilla", "", "Chantilly"), "");
  assert.equal(readCanonicalFormulaName("Vanilla Chantilly"), null);
});
