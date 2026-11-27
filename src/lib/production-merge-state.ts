/** Only batch membership changes; order recipe multipliers and logs never change. */
export function nextProductionMerge(
  current: ReadonlyMap<string, string>,
  ids: readonly string[],
  makeId: () => string,
): Map<string, string> {
  const next = new Map(current);
  if (!ids.length) return next;
  if (ids.length === 1) {
    const batch = next.get(ids[0]!);
    if (batch) {
      for (const [id, existing] of next) if (existing === batch) next.delete(id);
    }
    return next;
  }
  const joined = new Set(ids.map((id) => next.get(id)).filter((v): v is string => !!v));
  const batch = ids.map((id) => next.get(id)).find(Boolean) ?? makeId();
  for (const [id, existing] of next) {
    if (joined.has(existing)) next.set(id, batch);
  }
  for (const id of ids) next.set(id, batch);
  return next;
}

export function legacyBatchEntries(storage: unknown): [string, string][] {
  if (!Array.isArray(storage)) return [];
  return storage.filter(
    (item): item is [string, string] =>
      Array.isArray(item) && item.length === 2 && item.every((value) => typeof value === "string"),
  );
}

/** Local work-tab layouts cannot split a saved weighing batch. */
export function keepProductionBatchesTogether(
  tabs: readonly (readonly string[])[],
  batchBySelection: ReadonlyMap<string, string>,
): string[][] {
  const result = tabs.map((): string[] => []);
  const tabByBatch = new Map<string, number>();
  const seen = new Set<string>();
  for (const [index, ids] of tabs.entries()) {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const batch = batchBySelection.get(id);
      const target = batch ? (tabByBatch.get(batch) ?? index) : index;
      if (batch) tabByBatch.set(batch, target);
      result[target]!.push(id);
    }
  }
  return result;
}
