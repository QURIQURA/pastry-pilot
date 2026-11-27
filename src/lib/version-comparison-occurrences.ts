/**
 * Cross-version comparison rows are occurrences, not unique ingredient IDs.
 * Notes identify process stages (hot/cold cream); row UUIDs identify persisted
 * records. Neither repeated ingredient IDs nor a drag reorder may discard rows.
 */
export interface ComparisonIngredientRow {
  id: string;
  ingredient_id: string;
  sort_order: number;
  note: string | null;
}
export interface ComparisonOccurrence<T extends ComparisonIngredientRow> {
  id: string;
  ingredientId: string;
  firstSeenAt: number;
  sortOrder: number;
  byVersion: Map<string, T>;
}
const noteKey = (note: string | null) => note?.trim().toLocaleLowerCase() || null;

export function alignIngredientOccurrences<T extends ComparisonIngredientRow>(
  versions: readonly { id: string }[],
  rowsByVersion: readonly (readonly T[])[],
): ComparisonOccurrence<T>[] {
  const slots = new Map<string, ComparisonOccurrence<T>[]>();
  versions.forEach((version, versionIndex) => {
    const byIngredient = new Map<string, T[]>();
    for (const row of [...(rowsByVersion[versionIndex] ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
    )) {
      const list = byIngredient.get(row.ingredient_id) ?? [];
      list.push(row);
      byIngredient.set(row.ingredient_id, list);
    }
    for (const [ingredientId, lines] of byIngredient) {
      const existing = slots.get(ingredientId) ?? [];
      const assigned = new Set<string>();
      const unmatched: { row: T; ordinal: number }[] = [];
      // Match unchanged process notes first, even if their positions were swapped.
      for (const [ordinal, row] of lines.entries()) {
        const note = noteKey(row.note);
        const exact = note
          ? existing.find(
              (s) =>
                !assigned.has(s.id) &&
                [...s.byVersion.values()].some((v) => noteKey(v.note) === note),
            )
          : undefined;
        if (exact) {
          exact.byVersion.set(version.id, row);
          assigned.add(exact.id);
        } else unmatched.push({ row, ordinal });
      }
      for (const { row, ordinal } of unmatched) {
        // Notes may be newly edited, or absent; keep ordinal identity as fallback.
        const target =
          (existing[ordinal] && !assigned.has(existing[ordinal]!.id)
            ? existing[ordinal]
            : undefined) ?? existing.find((s) => !assigned.has(s.id));
        if (target) {
          target.byVersion.set(version.id, row);
          assigned.add(target.id);
        } else {
          const occurrence: ComparisonOccurrence<T> = {
            id: `${ingredientId}::${existing.length}`,
            ingredientId,
            firstSeenAt: versionIndex,
            sortOrder: row.sort_order,
            byVersion: new Map([[version.id, row]]),
          };
          existing.push(occurrence);
          assigned.add(occurrence.id);
        }
      }
      slots.set(ingredientId, existing);
    }
  });
  return [...slots.values()]
    .flat()
    .sort(
      (a, b) =>
        a.firstSeenAt - b.firstSeenAt || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
    );
}
