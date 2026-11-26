import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./load-ts.mjs";
const spec = await loadTs("src/lib/custom-spec.ts");

test("custom spec summary lists layers bottom-up with size abbreviations and free pieces", () => {
  const layer = (sort_order, extra) => ({
    sort_order,
    label: "",
    shape: null,
    size_inch: null,
    length_mm: null,
    width_mm: null,
    height_mm: null,
    ...extra,
  });
  const layers = [
    layer(2, { shape: "FREE", label: "Gingerbread sky" }),
    layer(0, { shape: "ROUND", size_inch: 10, height_mm: 80 }),
    layer(1, { shape: "ROUND", size_inch: 6 }),
  ];
  assert.equal(spec.customSpecSummary(layers), "Ø10″-H8 + Ø6″ + Gingerbread sky");
  assert.equal(spec.layerSizeText(layer(0, { shape: "FREE" })), "FREE");
  assert.equal(spec.layerSizeText(layer(0, { shape: "SQUARE", size_inch: 10 })), "■10″");
});
