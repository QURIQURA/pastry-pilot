import { Fragment, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  dashboardComponentsQuery,
  mouldsQuery,
  versionIngredientsQuery,
  workBlocksQuery,
  workSessionTasksQuery,
  type WorkSessionFormulaVersionRow,
} from "@/lib/queries";
import { formatDateTime } from "@/lib/datetime";
import { fmtNumber } from "@/lib/formula";
import { mouldAbbr } from "@/lib/component-size";
import { sumBaseGrams } from "@/lib/work-session";
import { mouldBatchGrams } from "@/lib/production-quantity";
import {
  removePlannedComponent,
  reopenComponentForProduction,
} from "@/lib/production-plan-actions";
import { invalidateProductionSync } from "@/lib/production-sync";
import { slotBoxClass } from "@/lib/slot-color";
import { cn } from "@/lib/utils";
import { OrderComponentPlanRow } from "./OrderComponentPlanRow";
import { useProductionMerge } from "./WorkSessionWorkspace";
import { buttonClass, selectClass } from "./ui";

export const productionOrderStatusClass = cn(selectClass, "w-32 bg-secondary text-xs uppercase");
export const productionTableButtonClass = cn(buttonClass, "px-1.5 text-[11px]");

export function ProductionOrderHeader({
  number,
  title,
  meta,
  status,
}: {
  number: string;
  title: ReactNode;
  meta: ReactNode;
  status: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-2">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
          <span className="label-caps border border-foreground px-1.5 py-0.5 text-[11px]">
            {number}
          </span>
          {title}
        </div>
        {meta && (
          <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{meta}</div>
        )}
      </div>
      <div className="min-w-0 max-w-[45%] shrink-0 [overflow-wrap:anywhere]">{status}</div>
    </header>
  );
}

type Selection = WorkSessionFormulaVersionRow;
type Section = "schedule" | "mould" | "settings" | "merge";
type Actual = { start: string | null; end: string | null; done: boolean };

export function ProductionComponentTable({
  sessionId,
  rows,
  title,
  readOnly,
  allowFormulaChange = false,
  details,
  warning,
}: {
  sessionId: string;
  rows: Selection[];
  title?: ReactNode;
  details?: ReactNode;
  readOnly: boolean;
  allowFormulaChange?: boolean;
  warning?: (id: string) => ReactNode;
}) {
  const blocks = useQuery(workBlocksQuery());
  const tasks = useQuery({ ...workSessionTasksQuery(sessionId), enabled: Boolean(sessionId) });
  const tasksById = new Map((tasks.data ?? []).map((task) => [task.id, task]));
  const [open, setOpen] = useState<{
    id: string;
    section: Section;
  } | null>(null);
  // Work day of every selection (earliest timed block, else the date-only plan) for batch merging.
  const workDate = new Map<string, string>();
  for (const block of blocks.data ?? []) {
    const id = block.work_session_formula_version_id;
    const current = workDate.get(id);
    if (!current || block.block_date < current) workDate.set(id, block.block_date);
  }
  const records = new Map<string, Actual>();
  const planned = new Map<string, string>();
  const rowIds = new Set(rows.map((row) => row.id));
  for (const block of blocks.data ?? []) {
    const id = block.work_session_formula_version_id;
    if (!rowIds.has(id)) continue;
    const scheduled = `${block.block_date} ${block.start_time.slice(0, 5)}`;
    if (!planned.has(id) || scheduled < planned.get(id)!) planned.set(id, scheduled);
    const task = block.work_session_task_id ? tasksById.get(block.work_session_task_id) : undefined;
    const record = records.get(id) ?? { start: null, end: null, done: true };
    const start = task?.actual_started_at;
    const end = task?.completed_at;
    if (start && (!record.start || Date.parse(start) < Date.parse(record.start)))
      record.start = start;
    if (end && (!record.end || Date.parse(end) > Date.parse(record.end))) record.end = end;
    record.done &&= task?.status === "DONE" && Boolean(end);
    records.set(id, record);
  }

  const doneCount = rows.filter((row) => records.get(row.id)?.done).length;
  return (
    <div className="min-w-0 border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-secondary px-2 py-1.5 [overflow-wrap:anywhere]">
        <div className="min-w-0">
          {title}
          {details}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {rows.length > 0 && blocks.isSuccess && tasks.isSuccess && (
            <span className="text-muted-foreground">
              컴포넌트 {doneCount}/{rows.length} 완료
            </span>
          )}
          {sessionId && (
            <Link
              className={productionTableButtonClass}
              to="/production/$sessionId"
              params={{ sessionId }}
            >
              생산 세션 ↗
            </Link>
          )}
        </div>
      </div>
      {(blocks.isError || tasks.isError) && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          생산 기록을 불러오지 못했습니다.
        </p>
      )}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[31rem] table-fixed border-collapse text-left text-xs [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_td]:[overflow-wrap:anywhere] [&_th]:border [&_th]:border-border [&_th]:bg-secondary [&_th]:px-2 [&_th]:py-1 [&_th]:[overflow-wrap:anywhere]">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[20%]" />
              <col className="w-[13%]" />
              <col className="w-[21%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">컴포넌트</th>
                <th scope="col">몰드</th>
                <th scope="col" className="text-right">
                  전체 중량
                </th>
                <th scope="col">생산 기록</th>
                <th scope="col">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ComponentRow
                  key={row.id}
                  row={row}
                  actual={records.get(row.id)}
                  planned={planned.get(row.id) ?? row.planned_date}
                  readOnly={readOnly}
                  allowFormulaChange={allowFormulaChange}
                  open={open?.id === row.id ? open.section : null}
                  toggle={(section) =>
                    setOpen(
                      open?.id === row.id && open.section === section
                        ? null
                        : { id: row.id, section },
                    )
                  }
                  close={() => setOpen((current) => (current?.id === row.id ? null : current))}
                  warning={warning?.(row.id)}
                  workDateOf={(id) => workDate.get(id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border-t border-border px-2 py-1.5 text-xs text-muted-foreground">
          컴포넌트 미지정
        </p>
      )}
    </div>
  );
}

function ComponentRow({
  row,
  actual,
  planned,
  readOnly,
  allowFormulaChange,
  open,
  toggle,
  close,
  warning,
  workDateOf,
}: {
  row: Selection;
  actual: Actual | undefined;
  planned: string | null;
  readOnly: boolean;
  allowFormulaChange: boolean;
  open: Section | null;
  toggle: (section: NonNullable<typeof open>) => void;
  close: () => void;
  warning?: ReactNode;
  workDateOf: (id: string) => string | undefined;
}) {
  const client = useQueryClient();
  const dashboard = useQuery(dashboardComponentsQuery());
  const day = workDateOf(row.id) ?? row.planned_date ?? null;
  const { batchBySelection, setBatch } = useProductionMerge(day ?? "unscheduled");
  const [mergeDraft, setMergeDraft] = useState<string[]>([]);
  const dashboardRows = dashboard.data ?? [];
  const batch = batchBySelection.get(row.id);
  const mergedWith = batch
    ? dashboardRows.filter(
        (other) => other.id !== row.id && batchBySelection.get(other.id) === batch,
      )
    : [];
  const mergeCandidates = day
    ? dashboardRows.filter(
        (other) =>
          other.id !== row.id &&
          other.formulaVersionId === row.formula_version_id &&
          (workDateOf(other.id) ?? other.plannedDate) === day &&
          !["COMPLETED", "CANCELLED"].includes(other.order.status) &&
          !batchBySelection.has(other.id),
      )
    : [];
  const ingredients = useQuery(versionIngredientsQuery(row.formula_version_id));
  const moulds = useQuery(mouldsQuery());
  const mould = moulds.data?.find((item) => item.id === row.mould_id);
  const count = Number(row.mould_qty);
  const raw = sumBaseGrams(ingredients.data ?? []) * Number(row.multiplier);
  const grams = mouldBatchGrams(
    raw,
    mould ? count : 0,
    mould?.reference_weight_g,
    row.batter_split_g,
  );
  const mouldLabel = mould ? mouldAbbr(mould) : "—";
  const canEditPlan = !readOnly && !actual?.start && !actual?.end && !actual?.done;
  const canEditMould =
    canEditPlan &&
    Boolean(row.mould_id || row.slot === "SHEET" || row.formula_versions.default_mould_id);
  const name = row.formula_versions.formulas.components?.name ?? row.formula_versions.formulas.name;
  const remove = useMutation({
    mutationFn: () => removePlannedComponent(row),
    onSuccess: (message) => {
      if (message) toast.error(message);
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => invalidateProductionSync(client),
  });
  const reopen = useMutation({
    mutationFn: () => reopenComponentForProduction(row),
    onSuccess: () => toast.success("다시 생산할 수 있게 일정을 비웠어요"),
    onError: (error) => toast.error(error.message),
    onSettled: () => invalidateProductionSync(client),
  });
  const start = actual?.start ? formatDateTime(actual.start) : null;
  const end = actual?.end ? formatDateTime(actual.end) : null;
  const recorded = actual?.done
    ? start && end
      ? `${start.slice(5)}–${start.slice(0, 10) === end.slice(0, 10) ? end.slice(11) : end.slice(5)}`
      : end?.slice(5)
    : start
      ? `${start.slice(5)} 시작`
      : planned
        ? `예정 ${planned.slice(5)}`
        : null;
  return (
    <Fragment>
      <tr className={actual?.done ? "bg-emerald-50/50 dark:bg-emerald-950/20" : undefined}>
        <td>
          <div className="flex flex-wrap items-baseline gap-1">
            <span className={cn("label-caps border px-1 text-[9px]", slotBoxClass(row.slot))}>
              {row.slot ?? "COMPONENT"}
            </span>
            <span className="min-w-0 font-medium">{name}</span>
            {warning}
          </div>
          {mergedWith.length > 0 ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              <span>
                ⇄ {mergedWith.map((other) => other.order.order_number).join(" + ")}와 병합 · {day}
              </span>
              {!readOnly && (
                <button type="button" className="underline" onClick={() => setBatch([row.id])}>
                  해제
                </button>
              )}
            </div>
          ) : (
            !readOnly &&
            !actual?.done &&
            mergeCandidates.length > 0 && (
              <button
                type="button"
                aria-expanded={open === "merge"}
                className="mt-0.5 text-[11px] underline underline-offset-2"
                onClick={() => {
                  setMergeDraft([]);
                  toggle("merge");
                }}
              >
                ⇄ 같은 포뮬라 병합 ({mergeCandidates.length})
              </button>
            )
          )}
        </td>
        <td>
          {canEditMould ? (
            <button
              type="button"
              aria-expanded={open === "mould"}
              aria-label={`${name} 몰드 수정`}
              className="max-w-full text-left underline underline-offset-2 [overflow-wrap:anywhere]"
              onClick={() => toggle("mould")}
            >
              {mould ? mouldLabel : "몰드 지정"}
            </button>
          ) : (
            mouldLabel
          )}
        </td>
        <td className="text-right font-mono tabular-nums">
          {ingredients.isSuccess
            ? `${fmtNumber(grams, 0)}g`
            : ingredients.isError
              ? "조회 실패"
              : "—"}
        </td>
        <td className="font-mono text-muted-foreground">
          {canEditPlan ? (
            <button
              type="button"
              aria-expanded={open === "schedule"}
              aria-label={`${name} 예정 날짜와 시간 수정`}
              className="max-w-full text-left underline underline-offset-2 [overflow-wrap:anywhere]"
              onClick={() => toggle("schedule")}
            >
              {recorded ?? "일정 지정"}
            </button>
          ) : (
            (recorded ?? "—")
          )}
        </td>
        <td>
          {actual?.done ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-medium text-emerald-800 dark:text-emerald-300">✓ 완료</span>
              {!readOnly && (
                <button
                  type="button"
                  aria-label="다시 생산"
                  title="다시 생산"
                  className="px-1 text-muted-foreground hover:text-foreground"
                  disabled={reopen.isPending}
                  onClick={() => {
                    if (confirm(`${name} 작업 기록과 배정을 초기화하고 다시 생산할까요?`))
                      reopen.mutate();
                  }}
                >
                  ↻
                </button>
              )}
            </div>
          ) : !readOnly ? (
            <button
              type="button"
              aria-expanded={open === "settings"}
              className={productionTableButtonClass}
              onClick={() => toggle("settings")}
            >
              {open === "settings" ? "닫기" : "설정"}
            </button>
          ) : (
            "—"
          )}
        </td>
      </tr>
      {canEditPlan && (open === "schedule" || open === "mould") && (
        <tr>
          <td colSpan={5}>
            <OrderComponentPlanRow key={open} row={row} section={open} onClose={close} />
          </td>
        </tr>
      )}
      {open === "merge" && !readOnly && mergeCandidates.length > 0 && (
        <tr>
          <td colSpan={5}>
            <div className="space-y-1.5 text-xs">
              <p>
                {day} 같은 날 만드는 {name}을(를) 한 번에 계량해요. 함께 만들 주문을 고르세요.
              </p>
              {mergeCandidates.map((other) => (
                <label key={other.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={mergeDraft.includes(other.id)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setMergeDraft((previous) =>
                        checked
                          ? [...previous, other.id]
                          : previous.filter((id) => id !== other.id),
                      );
                    }}
                  />
                  {other.order.order_number}
                  {other.order.customerName ? ` · ${other.order.customerName}` : ""}
                </label>
              ))}
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className={productionTableButtonClass}
                  disabled={!mergeDraft.length}
                  onClick={() => {
                    setBatch([row.id, ...mergeDraft]);
                    close();
                  }}
                >
                  {mergeDraft.length + 1}건 병합
                </button>
                <button type="button" className={productionTableButtonClass} onClick={close}>
                  닫기
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                병합하면 DASHBOARD WORK VIEW에서 한 열로 계량하고, 주문별 몰드 배분은 그대로 남아요.
              </p>
            </div>
          </td>
        </tr>
      )}
      {open === "settings" && !readOnly && !actual?.done && (
        <tr>
          <td colSpan={5}>
            <OrderComponentPlanRow row={row} allowFormulaChange={allowFormulaChange} />
            <button
              type="button"
              className={productionTableButtonClass}
              disabled={remove.isPending}
              onClick={() => {
                if (
                  confirm(
                    `${name} 지정을 삭제할까요? 예정 블록도 제거되며 원본 레시피는 유지됩니다.`,
                  )
                )
                  remove.mutate();
              }}
            >
              ✕ 삭제
            </button>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
