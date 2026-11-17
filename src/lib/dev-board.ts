// YEON OS Development Board (pastry-pilot#17) — pure helpers shared by the table, Kanban and graph.
// GitHub is the source of truth for issues/PRs/code; the board only links to it.

export const DEV_OS = ["SHCS", "PILOT", "PLANNER", "SHARED"] as const;
export type DevOs = (typeof DEV_OS)[number];

export const DEV_STATUSES = [
  "REQUESTED",
  "SPECIFIED",
  "IMPLEMENTING",
  "PR_OPEN",
  "REVIEWING",
  "MERGED",
  "DEPLOYED",
  "VERIFIED",
  "BLOCKED",
  "FAILED",
] as const;
export type DevStatus = (typeof DEV_STATUSES)[number];

export const DEV_STATUS_LABEL: Record<DevStatus, string> = {
  REQUESTED: "Requested",
  SPECIFIED: "Specified",
  IMPLEMENTING: "Implementing",
  PR_OPEN: "PR Open",
  REVIEWING: "Reviewing",
  MERGED: "Merged",
  DEPLOYED: "Deployed",
  VERIFIED: "Verified",
  BLOCKED: "Blocked",
  FAILED: "Failed",
};

/** Merged ≠ Deployed ≠ Verified: each is its own step and needs its own evidence. */
export const DEV_STATUS_HINT: Partial<Record<DevStatus, string>> = {
  MERGED: "Code is on main. Not yet deployed.",
  DEPLOYED: "Deployed. Runtime behaviour not yet verified.",
  VERIFIED: "Observed working end to end. Record the evidence.",
};

export const DEV_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type DevPriority = (typeof DEV_PRIORITIES)[number];

export const DEV_RELATION_KINDS = ["DEPENDS_ON", "BLOCKS", "PART_OF", "RELATED"] as const;
export type DevRelationKind = (typeof DEV_RELATION_KINDS)[number];
export const DEV_RELATION_LABEL: Record<DevRelationKind, string> = {
  DEPENDS_ON: "depends on",
  BLOCKS: "blocks",
  PART_OF: "part of",
  RELATED: "related to",
};

/** Repositories each OS lives in. Used for deep links and to restrict the GitHub sync. */
export const OS_REPOS: Record<Exclude<DevOs, "SHARED">, string> = {
  SHCS: "QURIQURA/shcs-order",
  PILOT: "QURIQURA/pastry-pilot",
  PLANNER: "QURIQURA/wann-planner",
};
export const ALLOWED_REPOS = [
  "QURIQURA/pastry-pilot",
  "QURIQURA/wann-planner",
  "QURIQURA/shcs-order",
  "QURIQURA/secret-occasion-cakes",
  "QURIQURA/kora-pilot",
] as const;

export function isDevStatus(v: unknown): v is DevStatus {
  return typeof v === "string" && (DEV_STATUSES as readonly string[]).includes(v);
}

export interface ParsedRef {
  kind: "ISSUE" | "PR" | "DOC" | "OTHER";
  repo: string | null;
  number: number | null;
  url: string;
  syncKey: string;
}

/**
 * Parses a GitHub issue/PR URL, an `owner/name#12` short ref, or any other https link.
 * Returns null for anything that is not https (no javascript:, no http:).
 */
export function parseRef(input: string, defaultRepo: string = OS_REPOS.PILOT): ParsedRef | null {
  const raw = input.trim();
  if (!raw) return null;
  const short = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/.exec(raw);
  if (short) {
    const repo = short[1] ?? defaultRepo;
    const number = Number(short[2]);
    return {
      kind: "ISSUE",
      repo,
      number,
      url: `https://github.com/${repo}/issues/${number}`,
      syncKey: `github:${repo}#${number}`,
    };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname === "github.com") {
    const m = /^\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)\/?$/.exec(url.pathname);
    if (m) {
      const repo = m[1]!;
      const number = Number(m[3]);
      return {
        kind: m[2] === "pull" ? "PR" : "ISSUE",
        repo,
        number,
        url: `https://github.com/${repo}/${m[2]}/${number}`,
        syncKey: `github:${repo}#${number}`,
      };
    }
    if (/\/(blob|tree)\//.test(url.pathname))
      return { kind: "DOC", repo: null, number: null, url: url.href, syncKey: `url:${url.href}` };
  }
  return { kind: "OTHER", repo: null, number: null, url: url.href, syncKey: `url:${url.href}` };
}

export function shortRef(ref: { repo: string | null; number: number | null; url: string }): string {
  if (ref.repo && ref.number) {
    const name = ref.repo.split("/")[1] ?? ref.repo;
    return `${name}#${ref.number}`;
  }
  try {
    const u = new URL(ref.url);
    return u.hostname + (u.pathname.length > 1 ? u.pathname.split("/").slice(-1)[0] : "");
  } catch {
    return ref.url;
  }
}

/** GitHub state, as cached by the sync, in one word. Never implies deployment. */
export function githubStateLabel(ref: {
  kind: string;
  gh_state: string | null;
  gh_draft: boolean | null;
  gh_merged_at: string | null;
}): string | null {
  if (!ref.gh_state) return null;
  if (ref.kind === "PR") {
    if (ref.gh_merged_at) return "merged";
    if (ref.gh_state === "open") return ref.gh_draft ? "draft" : "open";
    return "closed";
  }
  return ref.gh_state;
}

/**
 * A status the GitHub state suggests but never applies by itself. The board status stays the
 * person's call; e.g. a merged PR suggests MERGED, never DEPLOYED or VERIFIED.
 */
export function suggestedStatus(
  current: DevStatus,
  refs: {
    kind: string;
    gh_state: string | null;
    gh_draft: boolean | null;
    gh_merged_at: string | null;
  }[],
): DevStatus | null {
  const prs = refs.filter((r) => r.kind === "PR" && r.gh_state);
  if (prs.length === 0) return null;
  const rank = (s: DevStatus) => DEV_STATUSES.indexOf(s);
  let target: DevStatus | null = null;
  if (prs.every((r) => r.gh_merged_at)) target = "MERGED";
  else if (prs.some((r) => r.gh_state === "open")) target = "PR_OPEN";
  if (!target) return null;
  if (current === "BLOCKED" || current === "FAILED") return null;
  return rank(target) > rank(current) ? target : null;
}

export function nextWorkKey(existing: string[], prefix = "YOS"): string {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const k of existing) {
    const m = re.exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export interface DevFilterItem {
  work_key: string;
  title: string;
  goal: string | null;
  owning_os: string;
  affected_os: string[];
  status: string;
  priority: string;
  blocker: string | null;
  updated_at: string;
}

export interface DevFilter {
  q: string;
  os: DevOs[];
  statuses: DevStatus[];
}

export function filterItems<T extends DevFilterItem>(items: T[], f: DevFilter): T[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((i) => {
    if (f.os.length && !f.os.some((o) => i.owning_os === o || i.affected_os.includes(o)))
      return false;
    if (f.statuses.length && !f.statuses.includes(i.status as DevStatus)) return false;
    if (q) {
      const hay = `${i.work_key} ${i.title} ${i.goal ?? ""} ${i.blocker ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export type DevSortKey = "work_key" | "title" | "owning_os" | "status" | "priority" | "updated_at";

export function sortItems<T extends DevFilterItem>(
  items: T[],
  key: DevSortKey,
  dir: "asc" | "desc",
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (i: T): string | number =>
    key === "status"
      ? DEV_STATUSES.indexOf(i.status as DevStatus)
      : key === "priority"
        ? DEV_PRIORITIES.indexOf(i.priority as DevPriority)
        : i[key];
  return [...items].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * sign;
  });
}

/** True when the item touches more than one OS (owning + affected). */
export function isCrossOs(i: { owning_os: string; affected_os: string[] }): boolean {
  return new Set([i.owning_os, ...i.affected_os].filter((o) => o !== "SHARED")).size > 1;
}

/**
 * Graph layout: one column per owning OS, items stacked by status order. Deterministic so the
 * same records always land in the same place (no saved positions to drift).
 */
export function graphLayout(
  items: { id: string; owning_os: string; status: string; work_key: string }[],
): Record<string, { x: number; y: number }> {
  const cols: Record<string, number> = { SHCS: 0, PILOT: 1, PLANNER: 2, SHARED: 3 };
  const byCol = new Map<number, typeof items>();
  for (const i of items) {
    const c = cols[i.owning_os] ?? 3;
    byCol.set(c, [...(byCol.get(c) ?? []), i]);
  }
  const out: Record<string, { x: number; y: number }> = {};
  for (const [c, list] of byCol) {
    const sorted = [...list].sort(
      (a, b) =>
        DEV_STATUSES.indexOf(a.status as DevStatus) - DEV_STATUSES.indexOf(b.status as DevStatus) ||
        a.work_key.localeCompare(b.work_key, undefined, { numeric: true }),
    );
    sorted.forEach((i, row) => {
      out[i.id] = { x: c * 300, y: row * 120 + (c % 2) * 40 };
    });
  }
  return out;
}
