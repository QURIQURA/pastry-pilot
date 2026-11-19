/** A merge is a production view, never a deletion of order selections or their records. */
export interface QuantitySelection {
  id: string;
  formula_version_id: string;
  multiplier: number;
}

/** Publish the server-confirmed values to quantity rows and weighing columns together. */
export function applySavedQuantities<T extends { id: string; multiplier: number }>(
  rows: T[] | undefined,
  saved: { id: string; multiplier: number; updated_at: string }[],
): T[] | undefined {
  if (!rows) return rows;
  const byId = new Map(saved.map((r) => [r.id, r]));
  return rows.map((row) => {
    const update = byId.get(row.id);
    return update
      ? { ...row, multiplier: Number(update.multiplier), updated_at: update.updated_at }
      : row;
  });
}

export function groupProductionSelections<T extends QuantitySelection>(
  rows: T[],
  mergedVersions: ReadonlySet<string>,
): { key: string; members: T[]; multiplier: number }[] {
  const groups = new Map<string, { key: string; members: T[]; multiplier: number }>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue; // Split timeline blocks still represent one quantity.
    seen.add(row.id);
    const key = mergedVersions.has(row.formula_version_id)
      ? `version:${row.formula_version_id}`
      : `selection:${row.id}`;
    const group = groups.get(key) ?? { key, members: [], multiplier: 0 };
    group.members.push(row);
    group.multiplier += Number(row.multiplier);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Preserve order allocation ratios. The last member absorbs floating-point residue. */
export function rescaleProductionSelections<T extends QuantitySelection>(
  rows: T[],
  target: number,
) {
  if (!rows.length || !Number.isFinite(target) || target <= 0)
    throw new Error("생산량은 0보다 큰 숫자여야 합니다.");
  if (new Set(rows.map((r) => r.formula_version_id)).size !== 1)
    throw new Error("동일한 Formula 버전만 합칠 수 있습니다.");
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error("중복된 선택입니다.");
  const total = rows.reduce((sum, r) => sum + Number(r.multiplier), 0);
  if (
    !(total > 0) ||
    rows.some((r) => !Number.isFinite(Number(r.multiplier)) || Number(r.multiplier) <= 0)
  )
    throw new Error("기존 생산량을 확인해 주세요.");
  let assigned = 0;
  return rows.map((row, index) => {
    const multiplier =
      index === rows.length - 1 ? target - assigned : (target * Number(row.multiplier)) / total;
    assigned += multiplier;
    return { row, multiplier };
  });
}

/** Allocate whole grams while preserving the batch total, including the remainder. */
export function equalMouldSplit(batchGrams: number, count: number): number[] {
  const grams = Math.round(batchGrams);
  if (
    !Number.isSafeInteger(grams) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100 ||
    grams < count
  )
    return [];
  const perMould = Math.floor(grams / count);
  const remainder = grams % count;
  return Array.from({ length: count }, (_, index) => perMould + Number(index < remainder));
}

export function matchesMouldSplit(weights: number[], count: number, batchGrams: number): boolean {
  return (
    weights.length === count &&
    weights.every((grams) => Number.isSafeInteger(grams) && grams > 0) &&
    weights.reduce((sum, grams) => sum + grams, 0) === Math.round(batchGrams)
  );
}

/** Round the column once and distribute the difference to the largest fractional grams. */
export function roundIngredientGrams(lines: { id: string; grams: number }[]): Map<string, number> {
  const ordered = lines.map(({ id, grams }) => ({ id, grams, floor: Math.floor(grams) }));
  const target = Math.round(ordered.reduce((sum, line) => sum + line.grams, 0));
  const remainder = target - ordered.reduce((sum, line) => sum + line.floor, 0);
  ordered.sort((a, b) => b.grams - b.floor - (a.grams - a.floor) || a.id.localeCompare(b.id));
  return new Map(ordered.map((line, index) => [line.id, line.floor + Number(index < remainder)]));
}
