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
      <p className="text-[11px] text-muted-foreground">
        가용시간 자체는 Planner가 관리해요. 바꾸려면 Planner에서 수정하세요.
      </p>
    </div>
  );
}
