import { sizeAbbr } from "@/lib/size-label";

/**
 * 2026-11-26 (Issue #69): CUSTOM 멀티레이어 규격.
 * CUSTOM 규격 1개 = 레이어 여러 개(0 = 바닥), 레이어마다 컴포넌트 세트(시트+크림+인서트…).
 * 레이어 모양은 ROUND/SQUARE/RECTANGLE(사이즈 약어 체계) 또는 FREE(쿠키·배경 같은 자유 형태 조각).
 */
export const LAYER_SHAPES = ["ROUND", "SQUARE", "RECTANGLE", "FREE"] as const;
export const LAYER_COMPONENT_SLOTS = [
  "SHEET",
  "CREAM",
  "INSERT",
  "FILLING",
  "COOKIE",
  "DECOR",
  "OTHER",
] as const;

export interface LayerShapeInput {
  label?: string | null;
  shape: string | null;
  size_inch: number | null;
  length_mm: number | string | null;
  width_mm: number | string | null;
  height_mm: number | string | null;
}

const num = (v: number | string | null): number | null =>
  v == null || v === "" ? null : Number(v);

/** 레이어 치수 약어: Ø10″-H10, ■6″, ▬30×20-H4. FREE나 모양 없는 레이어는 이름(없으면 FREE). */
export function layerSizeText(layer: LayerShapeInput): string {
  if (!layer.shape || layer.shape === "FREE") return layer.label?.trim() || "FREE";
  return sizeAbbr({
    shape: layer.shape,
    size_inch: layer.size_inch,
    length_mm: num(layer.length_mm),
    width_mm: num(layer.width_mm),
    height_mm: num(layer.height_mm),
  });
}

/** 바닥부터 위로: "Ø10″ + Ø6″ + Gingerbread cookie" */
export function customSpecSummary(
  layers: readonly (LayerShapeInput & { sort_order: number })[],
): string {
  return [...layers]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(layerSizeText)
    .join(" + ");
}
