import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatTime } from "@/lib/datetime";
import {
  STATE_LABEL,
  conflictFor,
  formatMinutes,
  hhmmToMin,
  parseAvailabilityResponse,
  summarizeCapacity,
  type AvailabilitySegment,
  type AvailabilityState,
  type Interval,
  type PlannerAvailabilityResponse,
} from "@/lib/planner-availability";
import { cn } from "@/lib/utils";

/**
 * YEON OS Issue #4 — Planner availability shown READ-ONLY behind the existing DASHBOARD timeline.
 * Data comes from the `planner-availability` edge function (server-side; no WANN key in the browser).
 * Nothing here touches blocks, daily tasks, drag/drop or Planner sync. Failures never show as zero
 * capacity and never reach the dashboard's red error banner.
 */

const TOGGLE_KEY = "pilot-show-planner-context";
const STALE_AFTER_MS = 30 * 60 * 1000;

export function usePlannerContextToggle(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TOGGLE_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(TOGGLE_KEY, v ? "1" : "0");
    } catch {
      /* per-device convenience only */
    }
  };
  return [on, set];
}

export function usePlannerAvailability(date: string, enabled: boolean) {
  return useQuery({
    queryKey: ["planner_availability", date],
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<PlannerAvailabilityResponse> => {
      try {
        const { data, error } = await supabase.functions.invoke("planner-availability", {
          body: { from: date, to: date },
        });
        if (error) return { status: "unavailable", reason: "network" };
        return parseAvailabilityResponse(data);
      } catch {
        return { status: "unavailable", reason: "network" };
      }
    },
  });
}

export function segmentsForDate(
  data: PlannerAvailabilityResponse | undefined,
  date: string,
): AvailabilitySegment[] | null {
  if (!data || data.status !== "ok") return null;
  return data.days.find((d) => d.date === date)?.segments ?? null;
}

const LAYER_STYLE: Record<AvailabilityState, CSSProperties> = {
  available: { background: "rgba(79, 165, 140, 0.10)" },
  check: {
    background:
      "repeating-linear-gradient(135deg, rgba(181,162,66,0.12) 0 6px, transparent 6px 12px)",
  },
  unknown: {
    background:
      "repeating-linear-gradient(135deg, rgba(112,112,112,0.10) 0 4px, transparent 4px 10px)",
  },
  busy: { background: "rgba(112, 112, 112, 0.13)" },
};

/** Background bands on the linear hour scale. pointer-events: none — never intercepts drag/drop. */
export function PlannerAvailabilityLayer({
  segments,
  pxPerMin,
  left,
}: {
  segments: AvailabilitySegment[];
  pxPerMin: number;
  left: number;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0"
      style={{ left }}
      data-testid="planner-availability-layer"
    >
      {segments.map((s) => {
        const a = hhmmToMin(s.start);
        const b = hhmmToMin(s.end);
        return (
          <div
            key={`${s.start}-${s.state}`}
            className="absolute left-0 right-0"
            style={{ top: a * pxPerMin, height: (b - a) * pxPerMin, ...LAYER_STYLE[s.state] }}
            title={`${s.start}–${s.end} · ${STATE_LABEL[s.state]} · ${s.label}`}
          />
        );
      })}
    </div>
  );
}

/** One-line capacity summary + toggle, placed above the existing grid. */
export function PlannerCapacityStrip({
  on,
  onToggle,
  query,
  segments,
  work,
}: {
  on: boolean;
  onToggle: (v: boolean) => void;
  query: ReturnType<typeof usePlannerAvailability>;
  segments: AvailabilitySegment[] | null;
  work: Interval[];
}) {
  const summary = segments ? summarizeCapacity(segments, work) : null;
  const stale = query.dataUpdatedAt > 0 && Date.now() - query.dataUpdatedAt > STALE_AFTER_MS;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
      <label className="flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span className="label-caps text-[10px]">Show Planner context</span>
      </label>
      {on &&
        (query.isLoading ? (
          <span>Planner…</span>
        ) : summary ? (
          <>
            <span>
              Planner · Available {formatMinutes(summary.available)} · Allocated{" "}
              {formatMinutes(summary.allocated)} · Remaining {formatMinutes(summary.remaining)}
            </span>
            {summary.check > 0 && <span>· Check {formatMinutes(summary.check)}</span>}
            {summary.outside > 0 && (
              <span>· {formatMinutes(summary.outside)} outside available time</span>
            )}
            <span className={cn(stale && "text-foreground")}>
              · synced {formatTime(new Date(query.dataUpdatedAt))}
              {stale ? " (stale)" : ""}
            </span>
          </>
        ) : (
          <span>
            Planner availability unavailable ·{" "}
            <button type="button" className="underline" onClick={() => void query.refetch()}>
              retry
            </button>
          </span>
        ))}
    </div>
  );
}

/** Small non-blocking warning on a card whose time overlaps busy / unknown / check time. */
export function PlannerConflictChip({
  segments,
  start,
  end,
}: {
  segments: AvailabilitySegment[] | null;
  start: number;
  end: number;
}) {
  if (!segments) return null;
  const c = conflictFor(segments, { start, end });
  if (!c) return null;
  const text =
    c.state === "busy"
      ? "⚠ Planner busy"
      : c.state === "unknown"
        ? "⚠ care unknown"
        : "⚠ check time";
  return (
    <span
      className="font-mono text-[10px] opacity-80"
      title={`Outside available time: ${c.labels.join(", ")}`}
    >
      {text}
    </span>
  );
}
