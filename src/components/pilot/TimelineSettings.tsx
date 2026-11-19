import { useState } from "react";
import { STATE_LABEL, type AvailabilitySegment } from "@/lib/planner-availability";
import { cn } from "@/lib/utils";
import { PlannerCapacityStrip, type usePlannerAvailability } from "./PlannerAvailability";
import { buttonClass, inputClass } from "./ui";

/**
 * DASHBOARD "실제 작업 타임라인" display settings. Availability itself is owned by Planner and is
 * shown read-only here; PILOT only stores this browser's display choice (which range to draw).
 */
export type TimelineRange = { mode: "planner" | "custom"; start: string; end: string };

const RANGE_KEY = "pilot.production.timelineRange.v1";
const PLANNER_URL_KEY = "pilot.production.plannerUrl.v1";
export const PLANNER_APP_URL = "https://wann-planner.lovable.app";

function usePlannerUrl(): [string, (next: string) => void] {
  const [url, setUrl] = useState(() => {
    try {
      return localStorage.getItem(PLANNER_URL_KEY) || PLANNER_APP_URL;
    } catch {
      return PLANNER_APP_URL;
    }
  });
  const update = (next: string) => {
    setUrl(next);
    try {
      localStorage.setItem(PLANNER_URL_KEY, next);
    } catch {
      // Per-device convenience only.
    }
  };
  return [url, update];
}
const DEFAULT_RANGE: TimelineRange = { mode: "planner", start: "08:00", end: "18:00" };

export function useTimelineRange(): [TimelineRange, (next: TimelineRange) => void] {
  const [range, setRange] = useState<TimelineRange>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RANGE_KEY) ?? "null");
      return stored ? { ...DEFAULT_RANGE, ...stored } : DEFAULT_RANGE;
    } catch {
      return DEFAULT_RANGE;
    }
  });
  const update = (next: TimelineRange) => {
    setRange(next);
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify(next));
    } catch {
      // Per-device display preference only.
    }
  };
  return [range, update];
}

/** Segments to draw: Planner's available time, or the custom range (also the fallback). */
export function timelineSegments(
  range: TimelineRange,
  showPlanner: boolean,
  planner: AvailabilitySegment[] | null,
): { segments: { start: string; end: string }[]; fallback: boolean } {
  const valid = range.start < range.end;
  const custom = valid ? [{ start: range.start, end: range.end }] : [];
  if (range.mode === "custom" || !showPlanner) return { segments: custom, fallback: false };
  const available = (planner ?? []).filter((segment) => segment.state === "available");
  return available.length
    ? { segments: available, fallback: false }
    : { segments: custom, fallback: true };
}

export function TimelineSettingsPanel({
  range,
  onRange,
  showPlanner,
  onShowPlanner,
  query,
  segments,
  work,
  onClose,
}: {
  range: TimelineRange;
  onRange: (next: TimelineRange) => void;
  showPlanner: boolean;
  onShowPlanner: (on: boolean) => void;
  query: ReturnType<typeof usePlannerAvailability>;
  segments: AvailabilitySegment[] | null;
  work: { start: number; end: number }[];
  onClose: () => void;
}) {
  const [plannerUrl, setPlannerUrl] = usePlannerUrl();
  const [plannerOpen, setPlannerOpen] = useState(false);
  const safePlannerUrl = plannerUrl.startsWith("https://") ? plannerUrl : PLANNER_APP_URL;
  return (
    <div className="mt-2 space-y-3 border border-border bg-background p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="label-caps">타임라인 설정</p>
        <button type="button" className={buttonClass} onClick={onClose}>
          닫기
        </button>
      </div>
      <PlannerCapacityStrip
        on={showPlanner}
        onToggle={onShowPlanner}
        query={query}
        segments={showPlanner ? segments : null}
        work={work}
      />
      <fieldset className="space-y-1">
        <legend className="label-caps text-[11px] text-muted-foreground">표시 범위</legend>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="timeline-range"
            checked={range.mode === "planner"}
            onChange={() => onRange({ ...range, mode: "planner" })}
          />
          Planner 가용시간 (없으면 아래 기본 시간)
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="timeline-range"
            checked={range.mode === "custom"}
            onChange={() => onRange({ ...range, mode: "custom" })}
          />
          직접 지정
        </label>
        <div className="flex flex-wrap items-end gap-2 pl-5">
          <label>
            시작
            <input
              type="time"
              aria-label="타임라인 시작"
              className={cn(inputClass, "block")}
              value={range.start}
              onChange={(e) => e.target.value && onRange({ ...range, start: e.target.value })}
            />
          </label>
          <label>
            끝
            <input
              type="time"
              aria-label="타임라인 끝"
              className={cn(inputClass, "block")}
              value={range.end}
              onChange={(e) => e.target.value && onRange({ ...range, end: e.target.value })}
            />
          </label>
          {range.start >= range.end && (
            <p role="alert" className="text-destructive">
              끝 시간이 시작보다 늦어야 해요.
            </p>
          )}
        </div>
      </fieldset>
      {showPlanner && segments && segments.length > 0 && (
        <div className="space-y-0.5">
          <p className="label-caps text-[11px] text-muted-foreground">Planner 이날 시간</p>
          {segments.map((segment) => (
            <p key={`${segment.start}-${segment.end}`} className="font-mono text-[11px]">
              {segment.start}–{segment.end} · {STATE_LABEL[segment.state]}
              {segment.label ? ` · ${segment.label}` : ""}
            </p>
          ))}
        </div>
      )}
      <div className="space-y-1.5 border-t border-border pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="label-caps text-[11px]">Planner에서 가용시간 수정</p>
          <button
            type="button"
            className={buttonClass}
            disabled={plannerOpen}
            onClick={() => {
              // Google sign-in is blocked inside frames, so Planner opens as a small popup window.
              const popup = window.open(
                safePlannerUrl,
                "wann-planner",
                "popup,width=520,height=780",
              );
              if (!popup) return;
              popup.focus();
              setPlannerOpen(true);
              const timer = window.setInterval(() => {
                if (!popup.closed) return;
                window.clearInterval(timer);
                setPlannerOpen(false);
                void query.refetch();
              }, 1000);
            }}
          >
            {plannerOpen ? "Planner 창 열림…" : "Planner 작은 창 열기"}
          </button>
          <button
            type="button"
            className="text-[11px] underline"
            onClick={() => void query.refetch()}
          >
            ↻ 가용시간 다시 불러오기
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Planner 창에서 수정하고 닫으면 타임라인 가용시간을 자동으로 다시 불러와요. 창이 안 뜨면
          브라우저의 팝업 차단을 풀어 주세요.
        </p>
        <details>
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Planner 주소
          </summary>
          <input
            aria-label="Planner 주소"
            className={cn(inputClass, "mt-1 w-full")}
            defaultValue={plannerUrl}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next.startsWith("https://")) setPlannerUrl(next);
            }}
          />
        </details>
      </div>
    </div>
  );
}
