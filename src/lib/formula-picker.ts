import { resolveSlotGroup, type TechniqueCategory } from "@/lib/technique";

interface FormulaCandidate {
  id: string;
  name: string;
  technique_category_id: string | null;
  components?: { technique_category_id: string | null; name?: string } | null;
}

export function classifyFormulaForSlot(
  formula: FormulaCandidate,
  categories: TechniqueCategory[],
  slot: string,
) {
  const group = resolveSlotGroup(
    categories,
    formula.components?.technique_category_id ?? formula.technique_category_id,
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
      const labels = [formula.name, formula.components?.name ?? ""];
      if (!labels.some((label) => label.normalize("NFKC").toLocaleLowerCase().includes(query)))
        return false;
      return scope === "all" || classifyFormulaForSlot(formula, categories, slot) === scope;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** For selectors that use latest-by-number, only declarations on that exact version qualify. */
export function hasLatestVersionDietaryTag(
  versions: readonly { id: string; version_number: number }[],
  links: readonly { formula_version_id: string; dietary_tag_id: string }[],
  tagId: string,
) {
  const latest = versions.reduce<(typeof versions)[number] | undefined>(
    (current, version) =>
      !current || version.version_number > current.version_number ? version : current,
    undefined,
  );
  return Boolean(
    latest &&
    links.some((link) => link.formula_version_id === latest.id && link.dietary_tag_id === tagId),
  );
}
