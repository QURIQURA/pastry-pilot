import { resolveSlotGroup, type TechniqueCategory } from "@/lib/technique";

interface FormulaCandidate {
  id: string;
  name: string;
  technique_category_id: string | null;
  components?: { technique_category_id: string | null } | null;
}

export function classifyFormulaForSlot(
  formula: FormulaCandidate,
  categories: TechniqueCategory[],
  slot: string,
) {
  const group = resolveSlotGroup(
    categories,
    formula.technique_category_id ?? formula.components?.technique_category_id,
  );
  switch (slot) {
    case "SHEET":
    case "CREAM":
    case "FILLING":
      if (!group) return "unclassified";
      return group === slot ? "compatible" : "different";
    case "INSERT":
      // The legacy taxonomy groups inserts and fillings together.
      if (!group) return "unclassified";
      return group === "FILLING" ? "compatible" : "different";
    default:
      return "compatible";
  }
}

export function filterFormulaCandidates<T extends FormulaCandidate>(
  formulas: readonly T[],
  categories: TechniqueCategory[],
  slot: string,
  selected: string,
  search: string,
  scope: "compatible" | "unclassified" | "all",
) {
  const query = search.trim().normalize("NFKC").toLocaleLowerCase();
  return formulas
    .filter((formula) => {
      if (formula.id === selected) return true;
      if (!formula.name.normalize("NFKC").toLocaleLowerCase().includes(query)) return false;
      return scope === "all" || classifyFormulaForSlot(formula, categories, slot) === scope;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
