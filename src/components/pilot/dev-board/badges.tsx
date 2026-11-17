import { cn } from "@/lib/utils";
import { DEV_STATUS_LABEL, githubStateLabel, shortRef, type DevStatus } from "@/lib/dev-board";
import type { DevWorkRef } from "@/lib/dev-board-queries";

const OS_CLASS: Record<string, string> = {
  SHCS: "border-rose-400 text-rose-700 dark:text-rose-300",
  PILOT: "border-amber-500 text-amber-700 dark:text-amber-300",
  PLANNER: "border-sky-500 text-sky-700 dark:text-sky-300",
  SHARED: "border-muted-foreground text-muted-foreground",
};

export function OsBadge({ os }: { os: string }) {
  return (
    <span className={cn("inline-block border px-1 font-mono text-[10px] leading-4", OS_CLASS[os])}>
      {os}
    </span>
  );
}

const STATUS_CLASS: Record<DevStatus, string> = {
  REQUESTED: "bg-muted text-foreground",
  SPECIFIED: "bg-muted text-foreground",
  IMPLEMENTING: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  PR_OPEN: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  REVIEWING: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  MERGED: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100",
  DEPLOYED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  VERIFIED: "bg-emerald-600 text-white",
  BLOCKED: "bg-destructive text-destructive-foreground",
  FAILED: "bg-destructive text-destructive-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  const s = status as DevStatus;
  return (
    <span
      className={cn(
        "inline-block px-1.5 font-mono text-[10px] uppercase leading-4",
        STATUS_CLASS[s],
      )}
    >
      {DEV_STATUS_LABEL[s] ?? status}
    </span>
  );
}

/** Link to the GitHub issue/PR/doc, with the cached GitHub state if a sync has run. */
export function RefLink({ r }: { r: DevWorkRef }) {
  const state = githubStateLabel(r);
  return (
    <a
      href={r.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      title={r.title ?? r.url}
      className="inline-flex items-center gap-1 font-mono text-[11px] underline-offset-2 hover:underline"
    >
      {shortRef(r)}
      {state && <span className="text-[10px] text-muted-foreground">({state})</span>}
    </a>
  );
}
