/**
 * Planner availability overlay (YEON OS, Issue #4) — pure helpers, no I/O.
 *
 * Planner (WANN) owns childcare + personal schedule and decides each time segment's state.
 * Pilot only displays it, read-only, behind the existing DASHBOARD daily timeline.
 * Nothing here blocks or changes scheduling.
 *
 * States (policy approved by 연, 2026-11-15; the carer decides first, Planner computes this):
 *  - busy:      a timed Planner schedule (whoever the carer is), or Tanji with Yeon at any hour
 *  - available: Tanji with Lach / Tanji at Sage between 08:00 and 20:00
 *  - check:     Lach / Sage time before 08:00 or from 20:00, or an unrecorded night hour —
 *               work is possible but must be confirmed; not counted as available
 *  - unknown:   Shared (carer not decided) or Unassigned at any hour — not counted as available
 */

export type AvailabilityState = "available" | "check" | "unknown" | "busy";

export type AvailabilitySegment = {
  start: string; // "HH:MM" local Australia/Sydney wall-clock
  end: string; // "HH:MM", may be "24:00"
  state: AvailabilityState;
  reason: "childcare" | "planner_task" | "outside_window";
  carer: string | null;
  label: string;
  override: boolean;
};

export type AvailabilityDay = { date: string; segments: AvailabilitySegment[] };

export type PlannerAvailabilityResponse =
  | {
      status: "ok";
      source: "wann-planner";
      timezone: string;
      updated_at: string | null;
      days: AvailabilityDay[];
    }
  | { status: "unavailable"; reason: string };

export type Interval = { start: number; end: number }; // minutes from local midnight

export const STATE_LABEL: Record<AvailabilityState, string> = {
  available: "Available",
  check: "Check",
  unknown: "Unknown",
  busy: "Busy",
};

export function hhmmToMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

/** Validates an untrusted response body; anything unexpected becomes "unavailable" (never "free"). */
export function parseAvailabilityResponse(body: unknown): PlannerAvailabilityResponse {
  if (!body || typeof body !== "object") return { status: "unavailable", reason: "bad_response" };
  const b = body as Record<string, unknown>;
  if (b["status"] !== "ok") {
    return {
      status: "unavailable",
      reason: typeof b["reason"] === "string" ? b["reason"] : "unavailable",
    };
  }
  if (!Array.isArray(b["days"])) return { status: "unavailable", reason: "bad_response" };
  const states = new Set(["available", "check", "unknown", "busy"]);
  const days: AvailabilityDay[] = [];
  for (const d of b["days"] as unknown[]) {
    const day = d as Record<string, unknown>;
    if (typeof day?.["date"] !== "string" || !Array.isArray(day["segments"])) {
      return { status: "unavailable", reason: "bad_response" };
    }
    const segments: AvailabilitySegment[] = [];
    for (const s of day["segments"] as Record<string, unknown>[]) {
      if (
        typeof s?.["start"] !== "string" ||
        typeof s["end"] !== "string" ||
        !states.has(String(s["state"]))
      ) {
        return { status: "unavailable", reason: "bad_response" };
      }
      segments.push({
        start: s["start"],
        end: s["end"],
        state: s["state"] as AvailabilityState,
        reason: (s["reason"] as AvailabilitySegment["reason"]) ?? "childcare",
        carer: typeof s["carer"] === "string" ? s["carer"] : null,
        label:
          typeof s["label"] === "string"
            ? s["label"]
            : STATE_LABEL[s["state"] as AvailabilityState],
        override: s["override"] === true,
      });
    }
    days.push({ date: day["date"], segments });
  }
  return {
    status: "ok",
    source: "wann-planner",
    timezone: typeof b["timezone"] === "string" ? b["timezone"] : "Australia/Sydney",
    updated_at: typeof b["updated_at"] === "string" ? b["updated_at"] : null,
    days,
  };
}

/** Sorted, merged union of intervals (empty/negative ones dropped). */
export function unionIntervals(items: Interval[]): Interval[] {
  const sorted = items.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function overlapMinutes(a: Interval[], b: Interval[]): number {
  let total = 0;
  for (const x of a)
    for (const y of b) total += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start));
  return total;
}

function segmentsIn(segments: AvailabilitySegment[], state: AvailabilityState): Interval[] {
  return unionIntervals(
    segments
      .filter((s) => s.state === state)
      .map((s) => ({ start: hhmmToMin(s.start), end: hhmmToMin(s.end) })),
  );
}

export type CapacitySummary = {
  available: number; // minutes
  allocated: number; // Pilot work (blocks + daily tasks) inside available time
  remaining: number;
  check: number; // minutes that need confirmation (not counted as available)
  outside: number; // Pilot work scheduled outside available time
};

/**
 * Capacity for one day. Allocated = union of all Pilot timeline items (production blocks and
 * daily tasks, overlaps counted once) that fall inside available time.
 */
export function summarizeCapacity(
  segments: AvailabilitySegment[],
  work: Interval[],
): CapacitySummary {
  const available = segmentsIn(segments, "available");
  const check = segmentsIn(segments, "check");
  const busyWork = unionIntervals(work);
  const availableMin = available.reduce((t, i) => t + i.end - i.start, 0);
  const allocated = overlapMinutes(available, busyWork);
  const workMin = busyWork.reduce((t, i) => t + i.end - i.start, 0);
  return {
    available: availableMin,
    allocated,
    remaining: Math.max(0, availableMin - allocated),
    check: check.reduce((t, i) => t + i.end - i.start, 0),
    outside: workMin - allocated,
  };
}

export type Conflict = { state: Exclude<AvailabilityState, "available">; labels: string[] };

/**
 * Soft warning for one timeline item: the "worst" non-available state it overlaps
 * (busy > unknown > check). Returns null when it sits fully inside available time.
 */
export function conflictFor(segments: AvailabilitySegment[], item: Interval): Conflict | null {
  const rank: Record<AvailabilityState, number> = { available: 0, check: 1, unknown: 2, busy: 3 };
  let worst: Conflict | null = null;
  for (const s of segments) {
    if (s.state === "available") continue;
    const a = hhmmToMin(s.start);
    const b = hhmmToMin(s.end);
    if (Math.min(b, item.end) - Math.max(a, item.start) <= 0) continue;
    const st = s.state as Conflict["state"];
    if (!worst || rank[st] > rank[worst.state]) worst = { state: st, labels: [s.label] };
    else if (st === worst.state && !worst.labels.includes(s.label)) worst.labels.push(s.label);
  }
  return worst;
}

/** "6h", "4h 30m", "45m", "0m" */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
