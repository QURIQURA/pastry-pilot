import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DayWorkView,
  WorkSessionWorkspace,
  useProductionMerge,
} from "@/components/pilot/WorkSessionWorkspace";
import {
  CopyWarning,
  OrderFlagBoxes,
  orderTitle,
  useOrderDietaryNames,
} from "@/components/pilot/OrderTitle";
import { BlockTaskDetails, BlockTimerChip } from "@/components/pilot/BlockTaskDetails";
import { SessionExperimentButton } from "@/components/pilot/SessionExperimentButton";
import {
  PlannerAvailabilityLayer,
  PlannerCapacityStrip,
  PlannerConflictChip,
  segmentsForDate,
  usePlannerAvailability,
  usePlannerContextToggle,
} from "@/components/pilot/PlannerAvailability";
import { TimelineSettingsPanel, timelineSegments, useTimelineRange } from "./TimelineSettings";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  currentUserId,
  dailyTasksQuery,
  dailyTaskTemplatesQuery,
  dashboardComponentsQuery,
  baseWeightsQuery,
  mouldsQuery,
  ordersQuery,
  workBlocksQuery,
  workSessionTasksQuery,
  doneTaskIdsQuery,
  type DailyTask,
  type DailyTaskTemplate,
  type DashboardComponentRow,
  type WorkBlock,
} from "@/lib/queries";
import {
  addDays,
  formatDelivery,
  formatTime,
  koreanWeekdayShort,
  nowLocalTime,
  toLocalDateString,
} from "@/lib/datetime";
import {
  removeDailyTask,
  syncDailyTaskToPlanner,
  syncWorkSessionToPlanner,
} from "@/lib/work-session";
import { mouldAbbr } from "@/lib/component-size";
import { completeComponentBlocks, isBlockPast } from "@/lib/complete-blocks";
import { cn } from "@/lib/utils";
import { buttonClass, inputClass } from "./ui";

/**
 * PRODUCTION 메인보드 DASHBOARD (2026-10-22 사용자 요청) —
 * 왼쪽 "작업 대기공간": 진행 중인 오더들의 CORE 컴포넌트(Sheet/Cream/Filling) 중 아직 날짜/시간에
 * 배정 안 된 것. 오른쪽 "데일리 타임라인": 날짜를 골라 컴포넌트를 끌어다 시간에 배정한다.
 * 배정한 조각이 "작업 블록"(work_blocks)이고, 블록 1개 = WANN 플래너 TASK 1개.
 * 같은 컴포넌트를 "분할"하면 1차/2차 … 블록이 따로 생긴다(계량은 총량 하나 유지 — 기존 세션 화면 그대로).
 * 기존 WORK SESSION 기록/화면은 건드리지 않고, 블록은 컴포넌트 행을 참조만 한다.
 */

const DAY_START_MIN = 0;
const DAY_END_MIN = 24 * 60;
const PX_PER_HOUR = 56;
const PX_PER_MIN = PX_PER_HOUR / 60;
const SNAP_MIN = 15;
const DEFAULT_DURATION_MIN = 60;
const HOURS = Array.from(
  { length: (DAY_END_MIN - DAY_START_MIN) / 60 },
  (_, i) => i + DAY_START_MIN / 60,
);

// 오더별 구분색 — 상태 색상처럼 채도를 낮춘 톤(배경/강조선/글자).
const ORDER_PALETTE = [
  { bg: "#E8E4F3", accent: "#8B7FC7", text: "#3A2F6B" },
  { bg: "#DDEFE9", accent: "#4FA58C", text: "#1F5645" },
  { bg: "#F8E6D8", accent: "#D98A55", text: "#6B3A18" },
  { bg: "#F6DDE6", accent: "#C96F8D", text: "#6B2740" },
  { bg: "#E1E8F5", accent: "#6C8CCB", text: "#25406E" },
  { bg: "#EEE9D2", accent: "#B5A242", text: "#5A4E12" },
];

const nowMin = () => toMin(nowLocalTime());

function toMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}
function toTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
}
function hm(min: number): string {
  return toTime(min).slice(0, 5);
}
const snap = (m: number) => Math.round(m / SNAP_MIN) * SNAP_MIN;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

type DragPayload =
  | { kind: "row"; rowId: string }
  | { kind: "block"; blockId: string; offsetMin: number }
  // DAILY TASK — 라이브러리 항목을 끌어다 놓기(dailyNew) / 타임라인의 데일리 태스크 옮기기(daily)
  | { kind: "dailyNew"; templateId: string }
  | { kind: "daily"; taskId: string; offsetMin: number };

// 데일리 태스크(제품과 무관한 작업) 표시색 — 오더 색과 구분되는 무채색 톤.
const DAILY_COLOR = { bg: "#ECECEC", accent: "#707070", text: "#2E2E2E" };

const END_ROW_H = 20;
const CARD_EST_H = 48;
const LANE_W = 8;

/**
 * 타임라인 배치(WANN weekly 방식): 각 작업은 시작 시각에 카드, 끝 시각에 작은 종료 줄로 놓고
 * 둘을 같은 색 세로선으로 잇는다. 카드는 길이와 상관없이 폭을 다 쓰며 안 잘린다 — 위아래로
 * 겹치면 아래로 밀어 쌓는다. 선(진행 구간)이 겹치면 왼쪽 선 칸을 나눠 쓴다.
 */
function layoutStack(
  items: { id: string; start: number; end: number }[],
  heightOf: (id: string) => number,
) {
  type Entry = { id: string; kind: "start" | "end"; min: number; h: number };
  const entries: Entry[] = [];
  for (const it of items) {
    entries.push({ id: it.id, kind: "start", min: it.start, h: heightOf(it.id) });
    entries.push({ id: it.id, kind: "end", min: it.end, h: END_ROW_H });
  }
  entries.sort((a, b) => a.min - b.min || (a.kind === b.kind ? 0 : a.kind === "end" ? -1 : 1));
  const tops = new Map<string, { cardTop: number; endTop: number }>();
  let cursor = 0;
  for (const e of entries) {
    const top = Math.max((e.min - DAY_START_MIN) * PX_PER_MIN, cursor);
    cursor = top + e.h + 2;
    const cur = tops.get(e.id) ?? { cardTop: 0, endTop: 0 };
    if (e.kind === "start") cur.cardTop = top;
    else cur.endTop = top;
    tops.set(e.id, cur);
  }
  // 선 칸(레인): 구간이 겹치면 다른 칸
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const it of [...items].sort((a, b) => a.start - b.start || a.end - b.end)) {
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = it.end;
    lanes.set(it.id, lane);
  }
  const laneCount = Math.max(laneEnds.length, 1);
  return { tops, lanes, laneCount, height: cursor + 8 };
}

export function ProductionDashboard() {
  const queryClient = useQueryClient();
  const components = useQuery(dashboardComponentsQuery());
  const blocksQuery = useQuery(workBlocksQuery());
  const todayStr = toLocalDateString();
  const doneTaskIds = useQuery(doneTaskIdsQuery());
  const [date, setDate] = useState(() => toLocalDateString());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSessionNotes, setShowSessionNotes] = useState(false);
  const [workTabs, setWorkTabs] = useState<Record<string, string[][]>>(() => {
    try {
      const current = JSON.parse(localStorage.getItem("pilot.production.workTabs.v1") ?? "null");
      if (current) return current;
      const previous = JSON.parse(
        localStorage.getItem("pilot.production.secondMatrixRows.v1") ?? "{}",
      );
      return Object.fromEntries(Object.entries(previous).map(([day, ids]) => [day, [[], ids]]));
    } catch {
      return {};
    }
  });
  const [workTab, setWorkTab] = useState(0);
  const [workMenuId, setWorkMenuId] = useState<string | null>(null);
  const [recordRowId, setRecordRowId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    try {
      localStorage.setItem("pilot.production.workTabs.v1", JSON.stringify(workTabs));
    } catch {
      // Storage can be unavailable in private sessions.
    }
  }, [workTabs]);
  // 타임라인 아래 작업 박스(계량/워크플로 등)가 보여줄 세션 — 블록 선택 또는 대기공간 카드 클릭으로 정해진다.
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const [poolOver, setPoolOver] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [resize, setResize] = useState<{ id: string; endMin: number } | null>(null);
  const dailyQuery = useQuery(dailyTasksQuery());
  const dailyTemplatesQuery = useQuery(dailyTaskTemplatesQuery());
  const ordersData = useQuery(ordersQuery());
  const dietaryOf = useOrderDietaryNames();
  const mouldsData = useQuery(mouldsQuery());
  const [pickedRowIds, setPickedRowIds] = useState<string[]>([]);
  const [selectedDailyId, setSelectedDailyId] = useState<string | null>(null);
  const [dailyName, setDailyName] = useState("");
  const [dailySave, setDailySave] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => components.data ?? [], [components.data]);
  const blocks = useMemo(() => blocksQuery.data ?? [], [blocksQuery.data]);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const blocksByRow = useMemo(() => {
    const map = new Map<string, WorkBlock[]>();
    for (const b of blocks) {
      const list = map.get(b.work_session_formula_version_id) ?? [];
      list.push(b);
      map.set(b.work_session_formula_version_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.part_no - b.part_no);
    return map;
  }, [blocks]);

  // 오더별 구분색 — 오더 번호순으로 고정 배정해서 새로고침해도 색이 안 바뀐다.
  const orderColor = useMemo(() => {
    const ids = [...new Map(rows.map((r) => [r.order.id, r.order.order_number])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id]) => id);
    return (orderId: string) =>
      ORDER_PALETTE[Math.max(ids.indexOf(orderId), 0) % ORDER_PALETTE.length]!;
  }, [rows]);

  const isActive = (r: DashboardComponentRow) =>
    r.order.status !== "COMPLETED" && r.order.status !== "CANCELLED";

  const poolGroups = useMemo(() => {
    const groups = new Map<
      string,
      { order: DashboardComponentRow["order"]; rows: DashboardComponentRow[] }
    >();
    for (const r of rows) {
      if (!isActive(r)) continue;
      // Only genuinely unscheduled components belong in the waiting pool.
      // A component assigned on any date is already scheduled, even when
      // its time block is in the past or on a different selected day.
      if (r.plannedDate || (blocksByRow.get(r.id) ?? []).length > 0) continue;
      const g = groups.get(r.order.id) ?? { order: r.order, rows: [] };
      g.rows.push(r);
      groups.set(r.order.id, g);
    }
    return [...groups.values()].sort((a, b) =>
      a.order.order_number.localeCompare(b.order.order_number),
    );
  }, [rows, blocksByRow]);
  // 일정(블록 종료 시각)이 이미 지났는데 TASK가 완료되지 않은 컴포넌트 — 알림 표시 대상.
  const overdueIds = useMemo(() => {
    const ids = new Set<string>();
    if (!doneTaskIds.data) return ids;
    for (const r of rows) {
      if (!isActive(r)) continue;
      if (
        (blocksByRow.get(r.id) ?? []).some(
          (b) =>
            isBlockPast(b) &&
            !(b.work_session_task_id && doneTaskIds.data.has(b.work_session_task_id)),
        )
      )
        ids.add(r.id);
    }
    return ids;
  }, [rows, blocksByRow, doneTaskIds.data]);
  const completeRows = useMutation({
    mutationFn: async (targets: DashboardComponentRow[]) => {
      for (const r of targets)
        await completeComponentBlocks(
          r,
          blocksByRow.get(r.id) ?? [],
          doneTaskIds.data ?? new Set(),
        );
    },
    onSuccess: async () => {
      for (const key of ["work_blocks", "work_session_tasks", "dashboard_components"])
        await queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => setWarning((e as Error).message),
  });
  const poolCount = poolGroups.reduce((n, g) => n + g.rows.length, 0);
  const mouldById = useMemo(
    () => new Map((mouldsData.data ?? []).map((m) => [m.id, m])),
    [mouldsData.data],
  );
  const baseWeightsData = useQuery(baseWeightsQuery());
  const baseWeightById = useMemo(
    () => new Map((baseWeightsData.data ?? []).map((b) => [b.id, b])),
    [baseWeightsData.data],
  );
  const sizeText = (r: DashboardComponentRow) => {
    const parts: string[] = [];
    const m = r.mouldId ? mouldById.get(r.mouldId) : null;
    if (m) parts.push(`${mouldAbbr(m)}${r.mouldQty ? ` ×${r.mouldQty}` : ""}`);
    const bw = r.baseWeightId ? baseWeightById.get(r.baseWeightId) : null;
    if (bw) parts.push(`${bw.name}${r.baseWeightQty ? ` ×${r.baseWeightQty}` : ""}`);
    // Never present nominal mould capacity as actual recipe production weight.
    // The saved target is authoritative; otherwise show the multiplier without
    // guessing grams from a reference mould's nominal fill weight.
    if (r.targetQuantityG != null && r.targetQuantityG > 0)
      parts.push(`${Math.round(r.targetQuantityG)}g`);
    if (r.multiplier && r.multiplier !== 1)
      parts.push(`배수 ×${Math.round(r.multiplier * 100) / 100}`);
    if (r.plannedDate) parts.push(`날짜 계획 ${r.plannedDate} · 시간 미정`);
    return parts.join(" · ");
  };

  const dayBlocks = useMemo(
    () =>
      blocks.filter((b) => b.block_date === date && rowById.has(b.work_session_formula_version_id)),
    [blocks, date, rowById],
  );
  const dateOnlyRows = useMemo(
    () => rows.filter((r) => isActive(r) && r.plannedDate === date && !blocksByRow.has(r.id)),
    [rows, date, blocksByRow],
  );
  const effectiveEnd = (b: WorkBlock) => (resize?.id === b.id ? resize.endMin : toMin(b.end_time));
  const dailyTemplates = useMemo(() => dailyTemplatesQuery.data ?? [], [dailyTemplatesQuery.data]);
  const dayDailies = useMemo(
    () => (dailyQuery.data ?? []).filter((t) => t.task_date === date),
    [dailyQuery.data, date],
  );
  const dailyEnd = (t: DailyTask) => (resize?.id === t.id ? resize.endMin : toMin(t.end_time));
  // YEON OS #4: Planner availability — read-only background context; never blocks scheduling.
  const [showPlanner, setShowPlanner] = usePlannerContextToggle();
  const plannerAvailability = usePlannerAvailability(date, true);
  const [timelineRange, setTimelineRange] = useTimelineRange();
  const [timelineSettingsOpen, setTimelineSettingsOpen] = useState(false);
  const [dailyStart, setDailyStart] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState("30");
  // Where a daily task sits among production records: "time" (by start time) or before a work item.
  const [dailyPlacement, setDailyPlacement] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("pilot.production.dailyPlacement.v1") ?? "{}");
    } catch {
      return {};
    }
  });
  const placeDaily = (id: string, value: string) =>
    setDailyPlacement((prev) => {
      const next = { ...prev, [id]: value };
      try {
        localStorage.setItem("pilot.production.dailyPlacement.v1", JSON.stringify(next));
      } catch {
        // Per-device convenience only.
      }
      return next;
    });
  const plannerSegments = showPlanner ? segmentsForDate(plannerAvailability.data, date) : null;
  // 컴포넌트 블록이 선택돼 있으면 그쪽이 우선(둘이 동시에 선택되지 않게).
  const selectedDaily = selectedId
    ? null
    : (dayDailies.find((t) => t.id === selectedDailyId) ?? null);

  const selected = dayBlocks.find((b) => b.id === selectedId) ?? null;
  const selectedRow = selected ? rowById.get(selected.work_session_formula_version_id) : undefined;
  // 타임라인 아래 WORK VIEW 등은 "그날 블록이 속한 세션들"을 기본으로 보여준다(날짜 기준 작업공간).
  // 대기공간 카드를 눌러 고른 세션은, 그날 블록이 없어도 추가로 보여준다.
  const workspaceSessions = useMemo(() => {
    // WORK VIEW / ADJUST QUANTITY는 선택한 날짜에 블록이 있는 컴포넌트만(세션별로 묶어서) 보여준다.
    // 대기공간 카드를 눌러 고른 컴포넌트(아직 배정 전)는 그 카드만 추가로 보여준다.
    const bySession = new Map<string, string[]>();
    const sorted = [...dayBlocks].sort((a, b) => a.start_time.localeCompare(b.start_time));
    const add = (rowId: string) => {
      const r = rowById.get(rowId);
      if (!r) return;
      const list = bySession.get(r.work_session_id) ?? [];
      if (!list.includes(rowId)) list.push(rowId);
      bySession.set(r.work_session_id, list);
    };
    for (const b of sorted) add(b.work_session_formula_version_id);
    for (const row of dateOnlyRows) add(row.id);
    if (focusRowId && (blocksByRow.get(focusRowId) ?? []).length === 0) add(focusRowId);
    return [...bySession.entries()].map(([sid, rowIds]) => ({ sid, rowIds }));
  }, [dayBlocks, dateOnlyRows, rowById, blocksByRow, focusRowId]);
  // 합쳐진 WORK VIEW용: 타임라인 시간순으로 (세션 상관없이) 컴포넌트 열을 나열
  const dayWorkItems = useMemo(
    () =>
      workspaceSessions
        .flatMap(({ sid, rowIds }) => rowIds.map((rowId) => ({ sessionId: sid, rowId })))
        .sort((a, b) => {
          const first = (id: string) =>
            [...dayBlocks]
              .filter((x) => x.work_session_formula_version_id === id)
              .map((x) => x.start_time)
              .sort()[0] ?? "99:99";
          return first(a.rowId).localeCompare(first(b.rowId));
        }),
    [workspaceSessions, dayBlocks],
  );
  const storedTabs = workTabs[date] ?? [[], []];
  const activeTab = Math.min(workTab, storedTabs.length - 1);
  const itemsById = new Map(dayWorkItems.map((item) => [item.rowId, item]));
  const assigned = new Set(storedTabs.flat());
  const tabItems = storedTabs.map((ids, index) => [
    ...ids.flatMap((id) => itemsById.get(id) ?? []),
    ...(index === 0 ? dayWorkItems.filter((item) => !assigned.has(item.rowId)) : []),
  ]);
  const activeItems = tabItems[activeTab] ?? [];
  const updateTabs = (next: string[][]) => setWorkTabs((prev) => ({ ...prev, [date]: next }));
  const taskQueries = useQueries({
    queries: workspaceSessions.map(({ sid }) => workSessionTasksQuery(sid)),
  });
  const tasksById = new Map(
    taskQueries.flatMap((query) => (query.data ?? []).map((task) => [task.id, task] as const)),
  );
  const { batchBySelection, setBatch } = useProductionMerge(date);
  const tabByRow = new Map(
    tabItems.flatMap((items, index) => items.map((item) => [item.rowId, index] as const)),
  );
  const groupKeyForRow = (row: DashboardComponentRow) =>
    batchBySelection.has(row.id)
      ? `${tabByRow.get(row.id)}:${row.formulaVersionId}:${batchBySelection.get(row.id)}`
      : row.id;
  const stepKey = (block: WorkBlock) => block.step_name ?? `part-${block.part_no}`;
  const individualRecords = dayBlocks
    .flatMap((block) => {
      const row = rowById.get(block.work_session_formula_version_id);
      if (!row) return [];
      const task = block.work_session_task_id
        ? tasksById.get(block.work_session_task_id)
        : undefined;
      return [
        {
          block,
          row,
          start: task?.actual_started_at,
          end: task?.completed_at,
          done: task?.status === "DONE",
        },
      ];
    })
    .sort((a, b) => (a.start ?? "z").localeCompare(b.start ?? "z"));
  const groupedRecords = new Map<string, typeof individualRecords>();
  for (const record of individualRecords) {
    const key = `${groupKeyForRow(record.row)}:${stepKey(record.block)}`;
    const group = groupedRecords.get(key) ?? [];
    group.push(record);
    groupedRecords.set(key, group);
  }
  const productionRecords = [...groupedRecords.values()].flatMap((group) => {
    const recorded = group.filter((record) => record.start || record.end || record.done);
    // Keep independently recorded work visible when merging after work already took place.
    if (recorded.length > 1)
      return group.map((record) => ({
        ...record,
        rows: [record.row.id],
        mergedLabel: undefined,
      }));
    const primary = recorded[0] ?? group[0]!;
    return [
      {
        ...primary,
        rows: group.map((record) => record.row.id),
        mergedLabel:
          group.length > 1
            ? [...new Set(group.map((record) => record.row.order.order_number))].join(" + ")
            : undefined,
      },
    ];
  });
  const workGroups = tabItems.map((items) => {
    const groups = new Map<string, string[]>();
    for (const { rowId } of items) {
      const row = rowById.get(rowId);
      const key = row ? groupKeyForRow(row) : rowId;
      const members = groups.get(key) ?? [];
      members.push(rowId);
      groups.set(key, members);
    }
    return [...groups.values()];
  });
  // One order everywhere: the work tabs (1차, 2차 …) and their order drive the timeline chips,
  // the WORK VIEW columns and the production record list.
  const workPosition = new Map<string, number>();
  workGroups.flat().forEach((members, index) => {
    for (const id of members) workPosition.set(id, index);
  });
  const recordPosition = (record: { rows: string[] }) =>
    Math.min(...record.rows.map((id) => workPosition.get(id) ?? Number.MAX_SAFE_INTEGER));
  productionRecords.sort(
    (a, b) =>
      recordPosition(a) - recordPosition(b) ||
      a.block.block_date.localeCompare(b.block.block_date) ||
      a.block.start_time.localeCompare(b.block.start_time) ||
      (a.block.part_no ?? 0) - (b.block.part_no ?? 0),
  );
  const recordLane = (record: { rows: string[] }) => {
    const tabs = record.rows.flatMap((id) => tabByRow.get(id) ?? []);
    return tabs.length ? Math.min(...tabs) : 0;
  };
  // Daily tasks sit before the first open record planned after them, or before a chosen work item.
  const dailyPosition = (task: DailyTask) => {
    const start = toMin(task.start_time);
    const tie = start / 10_000;
    const placed = dailyPlacement[task.id];
    if (placed && placed !== "time") {
      if (placed === "end") return 1e9 + 1;
      const position = workPosition.get(placed);
      if (position != null) return position - 0.5 + tie / 10;
    }
    const next = productionRecords.find(
      (record) =>
        !record.done &&
        record.block.block_date === task.task_date &&
        toMin(record.block.start_time) > start,
    );
    return next ? recordPosition(next) - 0.5 + tie / 10 : 1e9 + tie;
  };
  const timelineLanes = workGroups.flatMap((groups, tab) =>
    groups.length > 0 || productionRecords.some((record) => recordLane(record) === tab)
      ? [tab]
      : [],
  );
  if (!timelineLanes.length) timelineLanes.push(0);
  const moveWork = (rowId: string, target: number, position?: number) => {
    const source = tabByRow.get(rowId);
    const group =
      source == null ? undefined : workGroups[source]?.find((items) => items.includes(rowId));
    if (!group || !workGroups[target]) return;
    const reordered = workGroups.map((groups) => groups.filter((items) => items !== group));
    const destination = reordered[target]!;
    destination.splice(position ?? destination.length, 0, group);
    updateTabs(reordered.map((groups) => groups.flat()));
    setWorkTab(target);
  };
  const hasRunningRecord = productionRecords.some(
    (record) => record.start && !record.end && !record.done,
  );
  useEffect(() => {
    if (!hasRunningRecord) return;
    const tick = () => setClock(new Date());
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, [hasRunningRecord]);
  const { segments: availableSegments, fallback: rangeFallback } = timelineSegments(
    timelineRange,
    showPlanner,
    segmentsForDate(plannerAvailability.data, date),
  );
  const recordMinute = (stamp: string | Date) => {
    const instant = new Date(stamp);
    const actualDay = toLocalDateString(instant);
    if (actualDay < date) return 0;
    if (actualDay > date) return 1440;
    return toMin(formatTime(instant)) + instant.getSeconds() / 60;
  };
  const completeRecords = productionRecords.filter((record) => record.done);
  const activeIds = new Set(activeItems.map((item) => item.rowId));
  const openRecords = productionRecords.filter(
    (record) => !record.done && record.rows.some((id) => activeIds.has(id)),
  );
  const showQueue =
    date >= todayStr &&
    (openRecords.length > 0 ||
      activeItems.some(
        (item) => !productionRecords.some((record) => record.rows.includes(item.rowId)),
      ));
  const focusRecord = (id: string) => {
    const index = tabItems.findIndex((items) => items.some((item) => item.rowId === id));
    if (index >= 0) setWorkTab(index);
    setRecordRowId(id);
  };
  // 오른쪽 디테일 창 — 선택한 블록(또는 대기공간에서 고른 카드)의 컴포넌트 하나. 병합돼 있으면 같이 묶인 것만 더한다.
  const detailRowId = selected?.work_session_formula_version_id ?? focusRowId ?? null;
  /** 병합 그룹: 같은 버전 + 같은 단계의 블록들. 대표(가장 이른 블록)만 그리고 나머지는 숨긴다. */
  const mergeGroups = useMemo(() => {
    const byKey = new Map<string, WorkBlock[]>();
    for (const b of dayBlocks) {
      const row = rowById.get(b.work_session_formula_version_id);
      if (!row || !batchBySelection.has(row.id)) continue;
      const tab = tabItems.findIndex((items) => items.some((item) => item.rowId === row.id));
      const key = `${tab}|${row.formulaVersionId}|${batchBySelection.get(row.id)}|${stepKey(b)}`;
      byKey.set(key, [...(byKey.get(key) ?? []), b]);
    }
    const hidden = new Set<string>();
    const primaries = new Map<string, { siblings: WorkBlock[]; orders: string[] }>();
    for (const list of byKey.values()) {
      const sorted = [...list].sort((a, b) => a.start_time.localeCompare(b.start_time));
      if (new Set(sorted.map((b) => b.work_session_formula_version_id)).size < 2) continue;
      const [primary, ...rest] = sorted as [WorkBlock, ...WorkBlock[]];
      rest.forEach((b) => hidden.add(b.id));
      primaries.set(primary.id, {
        siblings: rest,
        orders: [
          ...new Set(
            sorted.map((b) => rowById.get(b.work_session_formula_version_id)?.order.order_number),
          ),
        ].filter((o): o is string => !!o),
      });
    }
    return { hidden, primaries };
  }, [dayBlocks, rowById, batchBySelection, tabItems]);
  const visibleBlocks = useMemo(
    () => dayBlocks.filter((b) => !mergeGroups.hidden.has(b.id)),
    [dayBlocks, mergeGroups],
  );
  // 카드 실제 높이(글이 줄바꿈되면 커짐)를 재서, 겹치지 않게 쌓는 배치에 쓴다.
  const [cardHeights, setCardHeights] = useState<Map<string, number>>(() => new Map());
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = (el: HTMLElement | null) => {
    if (!el) return;
    if (!observerRef.current && typeof ResizeObserver !== "undefined") {
      observerRef.current = new ResizeObserver((entries) => {
        setCardHeights((prev) => {
          let next: Map<string, number> | null = null;
          for (const en of entries) {
            const id = (en.target as HTMLElement).dataset["measureId"];
            const h = Math.ceil(en.target.getBoundingClientRect().height);
            if (id && h > 0 && prev.get(id) !== h) {
              next ??= new Map(prev);
              next.set(id, h);
            }
          }
          return next ?? prev;
        });
      });
    }
    observerRef.current?.observe(el);
  };
  useEffect(() => () => observerRef.current?.disconnect(), []);
  const blockStack = useMemo(
    () =>
      layoutStack(
        visibleBlocks.map((b) => ({ id: b.id, start: toMin(b.start_time), end: effectiveEnd(b) })),
        (id) => cardHeights.get(id) ?? CARD_EST_H,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleBlocks, resize, cardHeights],
  );
  const dailyStack = useMemo(
    () =>
      layoutStack(
        dayDailies.map((t) => ({ id: t.id, start: toMin(t.start_time), end: dailyEnd(t) })),
        (id) => cardHeights.get(id) ?? CARD_EST_H,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayDailies, resize, cardHeights],
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["work_blocks"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard_components"] });
  };
  const syncAfter = async (sessionId: string) => {
    const err = await syncWorkSessionToPlanner(sessionId);
    setWarning(err ? `플래너 동기화에 실패했어요: ${err}` : null);
  };
  const blockTitle = (b: WorkBlock, row: DashboardComponentRow) => {
    const siblings = blocksByRow.get(row.id) ?? [];
    // 같은 포뮬라를 두 번 만드는 경우를 구분하도록 몰드 · 수량 · 중량을 이름 옆에 붙인다.
    const size = sizeText(row);
    const name = size ? `${row.componentName} · ${size}` : row.componentName;
    if (siblings.length <= 1) return name;
    return b.step_name ? `${name} — ${b.step_name}` : `${name} (${b.part_no}차)`;
  };

  const createBlock = useMutation({
    mutationFn: async (v: {
      row: DashboardComponentRow;
      startMin: number;
      endMin: number;
      day: string;
    }) => {
      const user_id = await currentUserId();
      const partNo =
        (blocksByRow.get(v.row.id) ?? []).reduce((m, b) => Math.max(m, b.part_no), 0) + 1;
      const inserts = [
        {
          user_id,
          work_session_formula_version_id: v.row.id,
          block_date: v.day,
          start_time: toTime(v.startMin),
          end_time: toTime(v.endMin),
          part_no: partNo,
        },
      ];
      const { data, error } = await supabase.from("work_blocks").insert(inserts).select("id");
      if (error) throw error;
      await syncAfter(v.row.work_session_id);
      return data?.[0]?.id ?? null;
    },
    onSuccess: async (id) => {
      await refresh();
      if (id) setSelectedId(id);
    },
  });

  const updateBlock = useMutation({
    mutationFn: async (v: {
      block: WorkBlock;
      day?: string;
      startMin?: number;
      endMin?: number;
    }) => {
      const row = rowById.get(v.block.work_session_formula_version_id);
      const { error } = await supabase
        .from("work_blocks")
        .update({
          block_date: v.day ?? v.block.block_date,
          start_time: v.startMin !== undefined ? toTime(v.startMin) : v.block.start_time,
          end_time: v.endMin !== undefined ? toTime(v.endMin) : v.block.end_time,
          updated_at: new Date().toISOString(),
        })
        .eq("id", v.block.id);
      if (error) throw error;
      // 병합된 블록의 대표를 옮기면 같이 굽는 나머지 블록도 같은 시간으로 따라간다.
      const merged = mergeGroups.primaries.get(v.block.id);
      const sessions = new Set<string>(row ? [row.work_session_id] : []);
      if (merged) {
        for (const sib of merged.siblings) {
          const { error: sibError } = await supabase
            .from("work_blocks")
            .update({
              block_date: v.day ?? v.block.block_date,
              start_time: v.startMin !== undefined ? toTime(v.startMin) : v.block.start_time,
              end_time: v.endMin !== undefined ? toTime(v.endMin) : v.block.end_time,
              updated_at: new Date().toISOString(),
            })
            .eq("id", sib.id);
          if (sibError) throw sibError;
          const sibRow = rowById.get(sib.work_session_formula_version_id);
          if (sibRow) sessions.add(sibRow.work_session_id);
        }
      }
      for (const sid of sessions) await syncAfter(sid);
    },
    onSuccess: refresh,
  });

  /** MERGE를 켜는 순간 같은 단계의 블록들을 가장 이른 블록의 시간으로 맞춘다. */
  const splitBlock = useMutation({
    mutationFn: async (block: WorkBlock) => {
      const row = rowById.get(block.work_session_formula_version_id);
      if (!row) return null;
      const user_id = await currentUserId();
      const duration = toMin(block.end_time) - toMin(block.start_time);
      const startMin = Math.min(toMin(block.end_time), DAY_END_MIN - duration);
      const partNo =
        (blocksByRow.get(row.id) ?? []).reduce((m, b) => Math.max(m, b.part_no), 0) + 1;
      const { data, error } = await supabase
        .from("work_blocks")
        .insert({
          user_id,
          work_session_formula_version_id: row.id,
          block_date: block.block_date,
          start_time: toTime(startMin),
          end_time: toTime(startMin + duration),
          part_no: partNo,
        })
        .select("id")
        .single();
      if (error) throw error;
      await syncAfter(row.work_session_id);
      return data.id;
    },
    onSuccess: async (id) => {
      await refresh();
      if (id) setSelectedId(id);
    },
  });

  // TASK 시작시각이 처음 기록되면 세션 시작 시각만 남긴다(세션 상태 기능은 2026-11-13에 제거).
  const ensureSessionStarted = async (sessionId: string, iso: string) => {
    await supabase
      .from("work_sessions")
      .update({ started_at: iso })
      .eq("id", sessionId)
      .is("started_at", null);
    await queryClient.invalidateQueries({ queryKey: ["work_sessions"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard_components"] });
  };

  // 배정 해제 — 블록과 그 플래너 TASK를 함께 지운다(Edge Function이 둘 다 처리).
  const removeBlock = useMutation({
    mutationFn: async (clicked: WorkBlock) => {
      const row = rowById.get(clicked.work_session_formula_version_id);
      // 템플릿 단계 블록은 한 덩어리 — 하나를 해제하면 그 컴포넌트의 모든 단계 블록이 대기공간으로 돌아간다.
      const targets = clicked.step_name
        ? blocks.filter(
            (b) => b.work_session_formula_version_id === clicked.work_session_formula_version_id,
          )
        : [clicked];
      for (const block of targets) {
        // 블록이 자동으로 만든 작업 기록(WORKFLOW TASK)은, 아직 아무 값도 안 넣었을 때만 같이 지운다.
        if (block.work_session_task_id) {
          await supabase
            .from("work_session_tasks")
            .delete()
            .eq("id", block.work_session_task_id)
            .eq("status", "NOT_STARTED")
            .is("actual_started_at", null)
            .is("completed_at", null)
            .is("output_quantity", null)
            .is("active_labour_minutes", null);
        }
        const { data, error } = await supabase.functions.invoke("sync-work-session-to-planner", {
          body: { remove_block_id: block.id, work_session_id: row?.work_session_id },
        });
        if (error) throw error;
        if (data && typeof data === "object" && "error" in data && data.error) {
          throw new Error(String((data as { error: unknown }).error));
        }
      }
    },
    onSuccess: async () => {
      setSelectedId(null);
      setWarning(null);
      await refresh();
    },
  });

  // ── DAILY TASKS(제품과 무관한 작업) ─────────────────────────────────────────
  const refreshDaily = async () => {
    await queryClient.invalidateQueries({ queryKey: ["daily_tasks"] });
    await queryClient.invalidateQueries({ queryKey: ["daily_task_templates"] });
  };
  const syncDaily = async (id: string) => {
    const err = await syncDailyTaskToPlanner(id);
    setWarning(err ? `플래너 동기화에 실패했어요: ${err}` : null);
  };

  const createDaily = useMutation({
    mutationFn: async (v: {
      name: string;
      startMin: number;
      endMin: number;
      day: string;
      template?: DailyTaskTemplate;
      saveToLibrary?: boolean;
    }) => {
      const user_id = await currentUserId();
      let templateId = v.template?.id ?? null;
      if (!v.template && v.saveToLibrary) {
        const maxSort = dailyTemplates.reduce((m, t) => Math.max(m, t.sort_order), 0);
        const { data: tpl, error: tplErr } = await supabase
          .from("daily_task_templates")
          .insert({
            user_id,
            name: v.name,
            default_minutes: Math.max(SNAP_MIN, v.endMin - v.startMin),
            sort_order: maxSort + 1,
          })
          .select("id")
          .single();
        if (tplErr) throw tplErr;
        templateId = tpl.id;
      }
      const { data, error } = await supabase
        .from("daily_tasks")
        .insert({
          user_id,
          task_date: v.day,
          start_time: toTime(v.startMin),
          end_time: toTime(v.endMin),
          name: v.name,
          task_type: v.template?.task_type ?? null,
          note: v.template?.note ?? null,
          template_id: templateId,
        })
        .select("id")
        .single();
      if (error) throw error;
      await syncDaily(data.id);
      return data.id;
    },
    onSuccess: async (id) => {
      setDailyName("");
      setDailySave(false);
      await refreshDaily();
      setSelectedId(null);
      setSelectedDailyId(id);
    },
  });

  const updateDaily = useMutation({
    mutationFn: async (v: {
      task: DailyTask;
      day?: string;
      startMin?: number;
      endMin?: number;
      name?: string;
      note?: string | null;
      orderId?: string | null;
    }) => {
      const { error } = await supabase
        .from("daily_tasks")
        .update({
          task_date: v.day ?? v.task.task_date,
          start_time: v.startMin !== undefined ? toTime(v.startMin) : v.task.start_time,
          end_time: v.endMin !== undefined ? toTime(v.endMin) : v.task.end_time,
          name: v.name ?? v.task.name,
          note: v.note !== undefined ? v.note : v.task.note,
          order_id: v.orderId !== undefined ? v.orderId : v.task.order_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", v.task.id);
      if (error) throw error;
      await syncDaily(v.task.id);
    },
    onSuccess: refreshDaily,
  });

  const deleteDaily = useMutation({
    mutationFn: async (task: DailyTask) => {
      const err = await removeDailyTask(task.id);
      if (err) throw new Error(err);
    },
    onSuccess: async () => {
      setSelectedDailyId(null);
      setWarning(null);
      await refreshDaily();
    },
  });

  const busy =
    createBlock.isPending ||
    updateBlock.isPending ||
    splitBlock.isPending ||
    removeBlock.isPending ||
    createDaily.isPending ||
    updateDaily.isPending ||
    deleteDaily.isPending;
  const firstError = [
    createBlock,
    updateBlock,
    splitBlock,
    removeBlock,
    createDaily,
    updateDaily,
    deleteDaily,
  ].find((m) => m.isError)?.error;

  // ── 드래그 앤 드롭 ───────────────────────────────────────────────────────────
  const minutesAt = (clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    return DAY_START_MIN + ((clientY - (rect?.top ?? 0)) / PX_PER_HOUR) * 60;
  };

  const onGridDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    let payload: DragPayload;
    try {
      payload = JSON.parse(e.dataTransfer.getData("text/plain")) as DragPayload;
    } catch {
      return;
    }
    const raw = minutesAt(e.clientY);
    if (payload.kind === "dailyNew" || payload.kind === "daily") return; // 데일리 칸에서만 처리
    if (payload.kind === "row") {
      const row = rowById.get(payload.rowId);
      if (!row) return;
      const startMin = clamp(snap(raw), DAY_START_MIN, DAY_END_MIN - DEFAULT_DURATION_MIN);
      createBlock.mutate({ row, startMin, endMin: startMin + DEFAULT_DURATION_MIN, day: date });
    } else {
      const block = blocks.find((b) => b.id === payload.blockId);
      if (!block) return;
      const duration = toMin(block.end_time) - toMin(block.start_time);
      const startMin = clamp(snap(raw - payload.offsetMin), DAY_START_MIN, DAY_END_MIN - duration);
      updateBlock.mutate({ block, day: date, startMin, endMin: startMin + duration });
    }
  };

  const onDailyDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    let payload: DragPayload;
    try {
      payload = JSON.parse(e.dataTransfer.getData("text/plain")) as DragPayload;
    } catch {
      return;
    }
    const raw = minutesAt(e.clientY);
    if (payload.kind === "dailyNew") {
      const tpl = dailyTemplates.find((t) => t.id === payload.templateId);
      if (!tpl) return;
      const dur = Math.max(SNAP_MIN, Math.ceil(tpl.default_minutes / SNAP_MIN) * SNAP_MIN);
      const startMin = clamp(snap(raw), DAY_START_MIN, DAY_END_MIN - dur);
      createDaily.mutate({
        name: tpl.name,
        startMin,
        endMin: startMin + dur,
        day: date,
        template: tpl,
      });
    } else if (payload.kind === "daily") {
      const task = (dailyQuery.data ?? []).find((t) => t.id === payload.taskId);
      if (!task) return;
      const duration = toMin(task.end_time) - toMin(task.start_time);
      const startMin = clamp(snap(raw - payload.offsetMin), DAY_START_MIN, DAY_END_MIN - duration);
      updateDaily.mutate({ task, day: date, startMin, endMin: startMin + duration });
    }
  };

  // 새 데일리 태스크 시작 시각 — 오늘 날짜를 보고 있으면 "생성하는 현재 시각"(2026-11-09 사용자
  // 요청), 다른 날짜면 그날 마지막 데일리 뒤(없으면 09:00)에 넣는다.
  const quickAddDaily = (
    name: string,
    minutes: number,
    template?: DailyTaskTemplate,
    explicitStart?: number,
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const dur = Math.max(SNAP_MIN, Math.ceil(minutes / SNAP_MIN) * SNAP_MIN);
    const lastEnd = dayDailies.reduce((m, t) => Math.max(m, toMin(t.end_time)), 0);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const baseMin = date === todayStr ? nowMin : lastEnd > 0 ? lastEnd : 9 * 60;
    const startMin = clamp(explicitStart ?? baseMin, DAY_START_MIN, DAY_END_MIN - dur);
    createDaily.mutate({
      name: trimmed,
      startMin,
      endMin: startMin + dur,
      day: date,
      ...(template ? { template } : {}),
      saveToLibrary: dailySave,
    });
  };

  const startResizeGeneric = (
    e: ReactPointerEvent<HTMLDivElement>,
    id: string,
    startMin: number,
    origEnd: number,
    commit: (endMin: number) => void,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    let latest = origEnd;
    setResize({ id, endMin: origEnd });
    const move = (ev: PointerEvent) => {
      latest = clamp(
        snap(origEnd + (ev.clientY - startY) / PX_PER_MIN),
        startMin + SNAP_MIN,
        DAY_END_MIN,
      );
      setResize({ id, endMin: latest });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResize(null);
      if (latest !== origEnd) commit(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const startResize = (e: ReactPointerEvent<HTMLDivElement>, block: WorkBlock) =>
    startResizeGeneric(e, block.id, toMin(block.start_time), toMin(block.end_time), (endMin) =>
      updateBlock.mutate({ block, endMin }),
    );
  const startDailyResize = (e: ReactPointerEvent<HTMLDivElement>, task: DailyTask) =>
    startResizeGeneric(e, task.id, toMin(task.start_time), toMin(task.end_time), (endMin) =>
      updateDaily.mutate({ task, endMin }),
    );

  // 터치/클릭용 빠른 배정 — 지금 현재 시각(5분 단위 내림)에 기본 1시간으로 넣는다(2026-11-04 요청).
  const quickAdd = (row: DashboardComponentRow) => {
    const now = new Date();
    const nowMin = Math.floor((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
    const startMin = clamp(nowMin, DAY_START_MIN, DAY_END_MIN - DEFAULT_DURATION_MIN);
    createBlock.mutate({ row, startMin, endMin: startMin + DEFAULT_DURATION_MIN, day: date });
  };

  // 시간 배정 전 컴포넌트 여러 개를 지금 현재 시각부터 차례로 이어서 넣는다.
  const addRowsToDay = async (rowIds: string[]) => {
    const now = new Date();
    let cursor = Math.floor((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
    for (const id of rowIds) {
      const row = rowById.get(id);
      if (!row) continue;
      const dur = DEFAULT_DURATION_MIN;
      const startMin = clamp(cursor, DAY_START_MIN, DAY_END_MIN - DEFAULT_DURATION_MIN);
      await createBlock.mutateAsync({
        row,
        startMin,
        endMin: startMin + DEFAULT_DURATION_MIN,
        day: date,
      });
      cursor = startMin + dur;
    }
    setPickedRowIds([]);
  };

  const gridHeight = Math.max(HOURS.length * PX_PER_HOUR, blockStack.height, dailyStack.height);

  return (
    <div className="space-y-3">
      {(warning || firstError) && (
        <p className="border border-destructive px-3 py-2 font-mono text-xs text-destructive">
          {warning ?? (firstError as Error).message}
        </p>
      )}

      <section className="space-y-3" aria-label="생산 작업 공간">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Work View</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={buttonClass}
              onClick={() => setDate(addDays(date, -1))}
            >
              ‹
            </button>
            <input
              aria-label="생산 날짜"
              className={inputClass}
              type="date"
              value={date}
              onChange={(event) => event.target.value && setDate(event.target.value)}
            />
            <button type="button" className={buttonClass} onClick={() => setDate(addDays(date, 1))}>
              ›
            </button>
          </div>
        </div>
        {date >= todayStr && (
          <div className="border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="label-caps text-xs">실제 작업 타임라인</h3>
              <button
                type="button"
                className={cn(buttonClass, timelineSettingsOpen && "bg-secondary")}
                aria-expanded={timelineSettingsOpen}
                onClick={() => setTimelineSettingsOpen((open) => !open)}
              >
                ⚙ 타임라인 설정
              </button>
            </div>
            {timelineSettingsOpen && (
              <TimelineSettingsPanel
                range={timelineRange}
                onRange={setTimelineRange}
                showPlanner={showPlanner}
                onShowPlanner={setShowPlanner}
                query={plannerAvailability}
                segments={plannerSegments}
                work={[
                  ...dayBlocks.map((b) => ({ start: toMin(b.start_time), end: effectiveEnd(b) })),
                  ...dayDailies.map((t) => ({ start: toMin(t.start_time), end: dailyEnd(t) })),
                ]}
                onClose={() => setTimelineSettingsOpen(false)}
              />
            )}
            <div className="mt-2 flex gap-2">
              {availableSegments.length > 0 && (
                <div className="w-12 shrink-0 space-y-1" aria-hidden>
                  <div className="font-mono text-[11px]">&nbsp;</div>
                  {timelineLanes.map((tab) => (
                    <div
                      key={tab}
                      className="label-caps h-7 text-[11px] leading-7 text-muted-foreground"
                    >
                      {tab + 1}차
                    </div>
                  ))}
                </div>
              )}
              <div className="flex min-w-0 flex-1 items-start gap-0 overflow-x-auto">
                {availableSegments.map((segment) => {
                  const start = toMin(segment.start);
                  const duration = toMin(segment.end) - start;
                  if (duration <= 0) return null;
                  return (
                    <div
                      key={segment.start}
                      className="min-w-0 shrink-0 space-y-1"
                      style={{ flexBasis: `${(duration / availableSegments.reduce((total, item) => total + Math.max(0, toMin(item.end) - toMin(item.start)), 0)) * 100}%` }}
                    >
                      <div className="flex justify-between font-mono text-[11px]">
                        <span>{segment.start}</span>
                        <span>{segment.end}</span>
                      </div>
                      {timelineLanes.map((tab) => (
                        <div
                          key={tab}
                          className={cn(
                            "relative h-7 border-r border-background",
                            "state" in segment && segment.state === "available" ? "bg-[#A9B79B]/30" :
                            "state" in segment && segment.state === "busy" ? "bg-[#BDBDB8]/60" :
                            "state" in segment && segment.state === "check" ? "bg-[#E8DFA8]/50" :
                            "state" in segment && segment.state === "unknown" ? "bg-muted" : "bg-muted",
                          )}
                          title={"state" in segment ? `${segment.start}–${segment.end} · ${segment.state}` : undefined}
                        >
                          {productionRecords.flatMap((record) => {
                            if (!record.start || recordLane(record) !== tab) return [];
                            const from = Math.max(start, recordMinute(record.start));
                            const until = Math.min(
                              start + duration,
                              recordMinute(record.end ?? clock),
                            );
                            if (until <= from) return [];
                            return (
                              <button
                                key={record.block.id}
                                type="button"
                                title={record.row.componentName}
                                className={cn(
                                  "absolute inset-y-0 truncate border border-border px-1 text-xs",
                                  record.done
                                    ? "bg-secondary"
                                    : "bg-primary text-primary-foreground",
                                )}
                                style={{
                                  left: `${((from - start) * 100) / duration}%`,
                                  width: `${((until - from) * 100) / duration}%`,
                                }}
                                onClick={() => focusRecord(record.row.id)}
                              >
                                {record.row.componentName}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            {rangeFallback && availableSegments.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Planner 가용시간이 없어 기본 시간({timelineRange.start}–{timelineRange.end})으로
                보여요
              </p>
            )}
            {!availableSegments.length && (
              <p className="mt-1 text-xs text-muted-foreground">
                표시할 시간이 없어요 · 타임라인 설정에서 범위를 지정하세요
              </p>
            )}
            {productionRecords
              .filter(
                (record) =>
                  record.start &&
                  !availableSegments.some(
                    ({ start, end }) =>
                      toMin(start) <= recordMinute(record.start!) &&
                      toMin(end) >= recordMinute(record.end ?? clock),
                  ),
              )
              .map((record) => (
                <button
                  type="button"
                  key={record.block.id}
                  className="mr-2 text-xs underline"
                  onClick={() => focusRecord(record.row.id)}
                >
                  가용시간 외 · {record.row.componentName} · {formatTime(record.start!)}
                  {record.end ? `–${formatTime(record.end)}` : ""}
                </button>
              ))}
            <div className="mt-2 space-y-1">
              {workGroups.map((groups, tab) =>
                groups.length === 0 ? null : (
                  <div key={tab} className="flex flex-wrap items-center gap-1">
                    <span className="label-caps w-12 shrink-0 text-[11px] text-muted-foreground">
                      {tab + 1}차
                    </span>
                    {groups.map((members, index) => {
                      const rowId = members[0]!;
                      const row = rowById.get(rowId);
                      const codes = [
                        ...new Set(
                          members.map((id) => rowById.get(id)?.order.order_number).filter(Boolean),
                        ),
                      ].join(" + ");
                      const open = workMenuId === rowId;
                      return (
                        <div key={rowId} className="relative">
                          <button
                            type="button"
                            className={cn(buttonClass, open && "bg-secondary")}
                            aria-expanded={open}
                            onClick={() => {
                              setWorkMenuId(open ? null : rowId);
                              focusRecord(rowId);
                            }}
                          >
                            {index + 1} · {row?.componentName}{" "}
                            <span className="text-muted-foreground">{codes}</span> ▾
                          </button>
                          {open && (
                            <div
                              className="absolute left-0 z-30 mt-1 w-44 space-y-2 border border-border bg-card p-2 shadow-md"
                              onKeyDown={(event) => {
                                if (event.key === "Escape") setWorkMenuId(null);
                              }}
                            >
                              <label className="block space-y-1 text-xs">
                                작업 탭
                                <select
                                  className="block w-full border border-border bg-background p-1"
                                  value={tab}
                                  onChange={(event) => moveWork(rowId, Number(event.target.value))}
                                >
                                  {workGroups.map((_, target) => (
                                    <option key={target} value={target}>
                                      {target + 1}차 작업
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block space-y-1 text-xs">
                                탭 안 작업 순서
                                <select
                                  className="block w-full border border-border bg-background p-1"
                                  value={groups.indexOf(members)}
                                  onChange={(event) => {
                                    moveWork(rowId, tab, Number(event.target.value));
                                    setWorkMenuId(null);
                                  }}
                                >
                                  {groups.map((_, position) => (
                                    <option key={position} value={position}>
                                      {position + 1}번째
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ),
              )}
            </div>
          </div>
        )}
        <div className={cn("grid gap-3", date >= todayStr && "xl:grid-cols-[minmax(0,1fr)_20rem]")}>
          {date >= todayStr && (
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap gap-1" aria-label="계량 작업">
                {tabItems.map((items, index) => (
                  <button
                    type="button"
                    key={index}
                    aria-pressed={activeTab === index}
                    className={cn(buttonClass, activeTab === index && "bg-secondary font-semibold")}
                    onClick={() => setWorkTab(index)}
                  >
                    {index + 1}차 작업 · {items.length}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="작업 탭 추가"
                  className={buttonClass}
                  onClick={() => {
                    updateTabs([...storedTabs, []]);
                    setWorkTab(storedTabs.length);
                  }}
                >
                  ＋
                </button>
              </div>
              {activeItems.length ? (
                <DayWorkView
                  part="WORK_VIEW"
                  key={`${date}-${activeTab}`}
                  items={activeItems}
                  batchBySelection={batchBySelection}
                  onSetBatch={setBatch}
                  labels={Object.fromEntries(rows.map((row) => [row.id, row.order.order_number]))}
                  onSelectColumn={focusRecord}
                  onColumnOrder={(ids) => {
                    const current = activeItems.map((item) => item.rowId);
                    const ordered = [...new Set(ids)].filter((id) => current.includes(id));
                    updateTabs(
                      tabItems.map((items, index) =>
                        index === activeTab
                          ? [...ordered, ...current.filter((id) => !ordered.includes(id))]
                          : items.map((item) => item.rowId),
                      ),
                    );
                  }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">컴포넌트를 이 작업 탭에 배정하세요.</p>
              )}
            </div>
          )}
          <aside className="space-y-2 min-w-0">
            {date >= todayStr && (
              <section className="space-y-2 border border-border bg-card p-3">
                <h3 className="label-caps text-xs">DAILY TASK · QUICK ADD</h3>
                <form
                  className="flex flex-wrap items-end gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    quickAddDaily(
                      dailyName,
                      Number(dailyMinutes) || DEFAULT_DURATION_MIN,
                      undefined,
                      dailyStart ? toMin(dailyStart) : undefined,
                    );
                    setDailyStart("");
                  }}
                >
                  <input
                    aria-label="데일리 작업 이름"
                    className={cn(inputClass, "min-w-0 flex-1")}
                    placeholder="작업 이름 (예: 오븐 청소)"
                    value={dailyName}
                    onChange={(e) => setDailyName(e.target.value)}
                  />
                  <input
                    type="time"
                    aria-label="데일리 작업 시작"
                    title="비우면 지금(오늘) 또는 마지막 데일리 뒤"
                    className={inputClass}
                    value={dailyStart}
                    onChange={(e) => setDailyStart(e.target.value)}
                  />
                  <input
                    type="number"
                    min={SNAP_MIN}
                    step={SNAP_MIN}
                    aria-label="데일리 작업 시간(분)"
                    className={cn(inputClass, "!w-16")}
                    value={dailyMinutes}
                    onChange={(e) => setDailyMinutes(e.target.value)}
                  />
                  <button
                    type="submit"
                    className={buttonClass}
                    disabled={createDaily.isPending || !dailyName.trim()}
                  >
                    + ADD
                  </button>
                  <label className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={dailySave}
                      onChange={(e) => setDailySave(e.target.checked)}
                    />
                    라이브러리에도 저장
                  </label>
                </form>
                {dailyTemplates.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {dailyTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={cn(buttonClass, "text-[11px]")}
                        style={{ borderLeft: `3px solid ${DAILY_COLOR.accent}` }}
                        disabled={createDaily.isPending}
                        onClick={() =>
                          quickAddDaily(
                            t.name,
                            t.default_minutes,
                            t,
                            dailyStart ? toMin(dailyStart) : undefined,
                          )
                        }
                      >
                        + {t.name} · {t.default_minutes}분
                      </button>
                    ))}
                  </div>
                )}
                {(createDaily.error || updateDaily.error || deleteDaily.error) && (
                  <p role="alert" className="text-xs text-destructive">
                    {(createDaily.error ?? updateDaily.error ?? deleteDaily.error)?.message}
                  </p>
                )}
              </section>
            )}
            {(showQueue || (date >= todayStr && dayDailies.length > 0)) && (
              <section className="border border-border bg-card p-3">
                <h3 className="font-semibold">생산 기록</h3>
                {[
                  ...openRecords.map((record) => ({
                    position: recordPosition(record),
                    node: (
                      <ProductionBlockRecord
                        key={record.block.id}
                        block={record.block}
                        row={record.row}
                        title={blockTitle(record.block, record.row)}
                        active={recordRowId != null && record.rows.includes(recordRowId)}
                        mergedLabel={record.mergedLabel}
                        onStarted={ensureSessionStarted}
                      />
                    ),
                  })),
                  ...activeItems
                    .filter(
                      (item) =>
                        !productionRecords.some((record) => record.rows.includes(item.rowId)),
                    )
                    .map((item) => ({
                      position: recordPosition({ rows: [item.rowId] }),
                      node: (
                        <p key={item.rowId} className="py-1 text-xs">
                          {rowById.get(item.rowId)?.componentName} · 시간 미정
                        </p>
                      ),
                    })),
                  ...dayDailies.map((task) => ({
                    position: dailyPosition(task),
                    node: (
                      <DailyRecordRow
                        key={task.id}
                        task={task}
                        placement={dailyPlacement[task.id] ?? "time"}
                        workItems={workGroups.flat().map((members, index) => {
                          const row = rowById.get(members[0]!);
                          return {
                            id: members[0]!,
                            label: `${index + 1}. ${row?.componentName ?? ""} ${row?.order.order_number ?? ""}`,
                          };
                        })}
                        busy={updateDaily.isPending || deleteDaily.isPending}
                        onPlace={(value) => placeDaily(task.id, value)}
                        onTime={(startMin, endMin) =>
                          updateDaily.mutate({ task, startMin, endMin })
                        }
                        onDelete={() => {
                          if (confirm(`${task.name} 데일리 작업을 삭제할까요?`))
                            deleteDaily.mutate(task);
                        }}
                      />
                    ),
                  })),
                ]
                  // Stable sort keeps a split component's parts in timeline order.
                  .sort((a, b) => a.position - b.position)
                  .map((entry) => entry.node)}
              </section>
            )}
            <section className="border border-border bg-card p-3">
              <h3 className="font-semibold">완료 목록 · {completeRecords.length}</h3>
              {completeRecords.map(({ block, row, rows, mergedLabel }) => (
                <ProductionBlockRecord
                  key={block.id}
                  block={block}
                  row={row}
                  title={blockTitle(block, row)}
                  active={recordRowId != null && rows.includes(recordRowId)}
                  mergedLabel={mergedLabel}
                  onStarted={ensureSessionStarted}
                />
              ))}
            </section>
            {date < todayStr && productionRecords.some((record) => !record.done) && (
              <section className="border border-border bg-card p-3">
                <h3 className="font-semibold">생산 기록</h3>
                {productionRecords
                  .filter((record) => !record.done)
                  .map(({ block, row, rows, mergedLabel }) => (
                    <ProductionBlockRecord
                      key={block.id}
                      block={block}
                      row={row}
                      title={blockTitle(block, row)}
                      active={recordRowId != null && rows.includes(recordRowId)}
                      mergedLabel={mergedLabel}
                      onStarted={ensureSessionStarted}
                    />
                  ))}
              </section>
            )}
          </aside>
        </div>
      </section>

      {/* ── 세션 메모 ── */}
      {workspaceSessions.length > 0 ? (
        <>
          <details
            className="border border-border bg-card"
            onToggle={(e) => setShowSessionNotes(e.currentTarget.open)}
          >
            <summary className="label-caps cursor-pointer px-3 py-2 text-xs">세션 메모</summary>
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              세션 전체 메모입니다. 생산 수량과 기록은 위 컴포넌트 행에서 관리하세요.
            </p>
            {showSessionNotes &&
              workspaceSessions.map(({ sid, rowIds }) => (
                <div key={sid} className="border-t border-border p-3">
                  <p className="mb-2 font-mono text-xs">
                    {[
                      ...new Set(
                        rows
                          .filter((r) => r.work_session_id === sid)
                          .map((r) => r.order.order_number),
                      ),
                    ].join(" / ")}
                  </p>
                  <WorkSessionWorkspace sessionId={sid} rowIds={rowIds} embedded />
                </div>
              ))}
          </details>
        </>
      ) : null}
    </div>
  );
}

/** WANN project/task hierarchy: production records mount only when their row is open. */
function ProductionBlockRecord({
  block,
  row,
  title,
  active,
  onStarted,
  mergedLabel,
}: {
  block: WorkBlock;
  row: DashboardComponentRow;
  title: string;
  active: boolean;
  onStarted: (sessionId: string, iso: string) => void | Promise<void>;
  /** 병합 컴포넌트의 한 벌 기록 — 이 기록이 함께 다루는 오더들 */
  mergedLabel?: string | undefined;
}) {
  const tasks = useQuery(workSessionTasksQuery(row.work_session_id));
  const task = tasks.data?.find((item) => item.id === block.work_session_task_id);
  const [expanded, setExpanded] = useState(active || task?.status === "IN_PROGRESS");
  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);
  return (
    <div className="border-b border-border/50 last:border-0">
      <div className="flex items-center gap-2">
        {task && task.status !== "DONE" && (
          <div className="shrink-0">
            <BlockTimerChip block={block} row={row} onStarted={onStarted} part="timer" />
          </div>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {row.componentName} · {mergedLabel ?? row.order.order_number}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {task?.actual_started_at
              ? `${formatTime(task.actual_started_at)}–${task.completed_at ? formatTime(task.completed_at) : "진행 중"}`
              : "시작 전"}
          </span>
        </button>
      </div>
      {expanded && (
        <BlockTaskDetails
          block={block}
          row={row}
          title={title}
          onStarted={onStarted}

          embedded
        />
      )}
    </div>
  );
}

/** A daily task (not tied to an order) shown between production records. */
function DailyRecordRow({
  task,
  placement,
  workItems,
  busy,
  onPlace,
  onTime,
  onDelete,
}: {
  task: DailyTask;
  placement: string;
  workItems: { id: string; label: string }[];
  busy: boolean;
  onPlace: (value: string) => void;
  onTime: (startMin: number, endMin: number) => void;
  onDelete: () => void;
}) {
  const start = toMin(task.start_time);
  const duration = Math.max(SNAP_MIN, toMin(task.end_time) - start);
  return (
    <div
      className="my-1 space-y-1 border border-border bg-background p-1.5 text-xs"
      style={{ borderLeft: `3px solid ${DAILY_COLOR.accent}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
          <span className="label-caps mr-1 text-[9px] text-muted-foreground">DAILY</span>
          {task.name}
        </span>
        <button
          type="button"
          aria-label={`${task.name} 삭제`}
          className="px-1 text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={onDelete}
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="time"
          aria-label={`${task.name} 시작`}
          className={cn(inputClass, "!w-24")}
          defaultValue={task.start_time.slice(0, 5)}
          key={task.start_time}
          disabled={busy}
          onBlur={(e) => {
            if (!e.target.value) return;
            const next = clamp(toMin(e.target.value), DAY_START_MIN, DAY_END_MIN - duration);
            if (next !== start) onTime(next, next + duration);
          }}
        />
        <span className="font-mono text-[11px] text-muted-foreground">
          –{toTime(start + duration).slice(0, 5)} · {duration}분
        </span>
        <select
          aria-label={`${task.name} 순서`}
          className="min-w-0 flex-1 border border-border bg-background p-0.5 text-[11px]"
          value={placement}
          onChange={(e) => onPlace(e.target.value)}
        >
          <option value="time">시간 순</option>
          {workItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} 앞
            </option>
          ))}
          <option value="end">맨 끝</option>
        </select>
      </div>
    </div>
  );
}
