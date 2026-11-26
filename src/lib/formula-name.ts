export const FORMULA_TEXTURES = ["Soft", "Medium", "Hard"] as const;
export type FormulaTexture = (typeof FORMULA_TEXTURES)[number];

export function canonicalFormulaName(flavour: string, texture: string, productType: string) {
  const terms = [flavour, productType].map((term) =>
    term.normalize("NFKC").trim().replace(/\s+/gu, " "),
  );
  if (!FORMULA_TEXTURES.some((allowed) => allowed === texture)) return "";
  if (terms.some((term) => !term || /[·]|\b(?:GF|DF|HALAL|V\d+)\b/iu.test(term))) return "";
  return [terms[0], texture, terms[1]].join(" · ");
}

export function readCanonicalFormulaName(name: string) {
  const [flavour, texture, productType, ...extra] = name.split(" · ");
  if (extra.length || !flavour || !texture || !productType) return null;
  if (canonicalFormulaName(flavour, texture, productType) !== name) return null;
  return { flavour, texture, productType };
}
