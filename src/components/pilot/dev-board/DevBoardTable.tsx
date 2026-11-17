import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  DEV_PRIORITIES,
  DEV_STATUSES,
  DEV_STATUS_LABEL,
  isCrossOs,
  sortItems,
  type DevSortKey,
} from "@/lib/dev-board";
import type { DevWorkItem, DevWorkRef } from "@/lib/dev-board-queries";
import { OsBadge, RefLink } from "./badges";

const COLS: { key: string; label: string; sort?: DevSortKey; w: string }[] = [
  { key: "work_key", label: "Work ID", sort: "work_key", w: "w-[72px]" },
  { key: "title", label: "Goal / problem", sort: "title", w: "min-w-[220px]" },
  { key: "expected", label: "Expected outcome", w: "min-w-[180px]" },
  { key: "actual", label: "Actual result", w: "min-w-[160px]" },
  { key: "owning_os", label: "Owner", sort: "owning_os", w: "w-[70px]" },
  { key: "affected", label: "Affected", w: "w-[120px]" },
  { key: "status", label: "Status", sort: "status", w: "w-[120px]" },
  { key: "priority", label: "Pri", sort: "priority", w: "w-[56px]" },
  { key: "issues", label: "Issues", w: "w-[120px]" },
  { key: "prs", label: "PRs", w: "w-[120px]" },
  { key: "tests", label: "Tests", w: "min-w-[120px]" },
  { key: "deployment", label: "Deployment", w: "min-w-[120px]" },
  { key: "runtime", label: "Runtime verification", w: "min-w-[140px]" },
  { key: "blocker", label: "Blocker", w: "min-w-[120px]" },
  { key: "updated_at", label: "Updated", sort: "updated_at", w: "w-[86px]" },
];

const cell = "border-b border-r border-border px-1.5 py-1 align-top";
const clamp = "line-clamp-2 whitespace-pre-line";

export function DevBoardTable({
  items,
  refs,
  onOpen,
  onPatch,
}: {
  items: DevWorkItem[];
  refs: DevWorkRef[];
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: { status?: string; priority?: string }) => void;
}) {
  const [sort, setSort] = useState<{ key: DevSortKey; dir: "asc" | "desc" }>({
    key: "work_key",
    dir: "asc",
  });
  const rows = sortItems(items, sort.key, sort.dir);
  const refsOf = (id: string, kind: string) =>
    refs.filter((r) => r.work_item_id === id && r.kind === kind);

  return (
    <div className="overflow-auto border-l border-t border-border bg-card">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[12px]">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
                className={cn(cell, c.w, "label-caps text-left text-[10px] text-muted-foreground")}
              >
                {c.sort ? (
                  <button
                    type="button"
                    className="hover:text-foreground"
                    onClick={() =>
                      setSort((s) => ({
                        key: c.sort!,
                        dir: s.key === c.sort && s.dir === "asc" ? "desc" : "asc",
                      }))
                    }
                  >
                    {c.label}
                    {sort.key === c.sort ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={COLS.length}
                className={cn(cell, "py-4 text-center font-mono text-xs text-muted-foreground")}
              >
                No work items match.
              </td>
            </tr>
          )}
          {rows.map((i) => (
            <tr
              key={i.id}
              className="cursor-pointer hover:bg-secondary/60"
              onClick={() => onOpen(i.id)}
            >
              <td className={cn(cell, "font-mono")}>{i.work_key}</td>
              <td className={cell}>
                <div className="font-medium">{i.title}</div>
                {i.goal && <div className={cn(clamp, "text-muted-foreground")}>{i.goal}</div>}
              </td>
              <td className={cell}>
                <div className={clamp}>{i.expected_outcome}</div>
              </td>
              <td className={cell}>
                <div className={clamp}>{i.actual_result}</div>
              </td>
              <td className={cell}>
                <OsBadge os={i.owning_os} />
              </td>
              <td className={cell}>
                <div className="flex flex-wrap gap-0.5">
                  {i.affected_os.map((o) => (
                    <OsBadge key={o} os={o} />
                  ))}
                  {isCrossOs(i) && (
                    <span className="font-mono text-[10px] text-muted-foreground">cross-OS</span>
                  )}
                </div>
              </td>
              <td className={cell} onClick={(e) => e.stopPropagation()}>
                <select
                  aria-label="Status"
                  value={i.status}
                  onChange={(e) => onPatch(i.id, { status: e.target.value })}
                  className="w-full bg-transparent font-mono text-[11px]"
                >
                  {DEV_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {DEV_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </td>
              <td className={cell} onClick={(e) => e.stopPropagation()}>
                <select
                  aria-label="Priority"
                  value={i.priority}
                  onChange={(e) => onPatch(i.id, { priority: e.target.value })}
                  className="w-full bg-transparent font-mono text-[11px]"
                >
                  {DEV_PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </td>
              <td className={cell}>
                <div className="flex flex-col">
                  {refsOf(i.id, "ISSUE").map((r) => (
                    <RefLink key={r.id} r={r} />
                  ))}
                </div>
              </td>
              <td className={cell}>
                <div className="flex flex-col">
                  {refsOf(i.id, "PR").map((r) => (
                    <RefLink key={r.id} r={r} />
                  ))}
                </div>
              </td>
              <td className={cell}>
                <div className={clamp}>{i.tests}</div>
              </td>
              <td className={cell}>
                <div className={clamp}>{i.deployment}</div>
              </td>
              <td className={cell}>
                <div className={clamp}>{i.runtime_verification}</div>
              </td>
              <td className={cn(cell, i.blocker && "text-destructive")}>
                <div className={clamp}>{i.blocker}</div>
              </td>
              <td className={cn(cell, "font-mono text-[11px] text-muted-foreground")}>
                {new Date(i.updated_at).toLocaleDateString("en-AU", {
                  timeZone: "Australia/Sydney",
                  day: "2-digit",
                  month: "short",
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
