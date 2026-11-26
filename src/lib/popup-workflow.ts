export interface PopupStage {
  id: string;
  label: string;
}
export const DEFAULT_POPUP_STAGES: PopupStage[] = [
  { id: "PLANNING", label: "CONFIRMED" },
  { id: "PREPARING", label: "MENU PLANNING" },
  { id: "PRODUCTION", label: "ORDER REVIEW" },
  { id: "READY", label: "PREP" },
  { id: "LIVE", label: "POP-UP" },
  { id: "COMPLETED", label: "COMPLETED" },
];
/**
 * 2026-11-27 (연, #71): 반려. 편집 가능한 진행 단계와 별도로 항상 있는 시스템 단계.
 * 반려하면 DB가 번호를 SND-REJ-nnn으로 바꾸고, 다음 팝업 번호는 반려된 번호를 건너뛴다.
 */
export const REJECTED_STAGE: PopupStage = { id: "REJECTED", label: "REJECTED" };
export const REJECTED_COLOR = "#b91c1c";
export function readPopupStages(value: unknown): PopupStage[] {
  return Array.isArray(value) && value.length
    ? (value as PopupStage[])
    : DEFAULT_POPUP_STAGES.map((s) => ({ ...s }));
}
export function validatePopupStages(stages: PopupStage[]): string | null {
  if (stages.length < 2 || stages.length > 30)
    return "진행 단계는 완료 단계를 포함해 2–30개로 구성하세요";
  if (stages.at(-1)?.id !== "COMPLETED") return "완료 단계는 마지막에 유지하세요";
  if (stages.some((s) => s.id === REJECTED_STAGE.id || s.label.trim().toUpperCase() === "REJECTED"))
    return "REJECTED는 반려 전용 단계라 추가할 수 없습니다";
  if (
    stages.some(
      (s) => !/^[A-Za-z0-9_-]{1,80}$/.test(s.id) || !s.label.trim() || s.label.trim().length > 80,
    )
  )
    return "단계 이름은 1–80자로 입력하세요";
  if (
    new Set(stages.map((s) => s.id)).size !== stages.length ||
    new Set(stages.map((s) => s.label.trim().toLowerCase())).size !== stages.length
  )
    return "같은 이름의 진행 단계가 있습니다";
  return null;
}
export function popupStageId(
  plan: { stage_id?: string },
  status: string,
  stages: PopupStage[],
): string {
  if (status === "REJECTED") return REJECTED_STAGE.id;
  return plan.stage_id || (status === "COMPLETED" ? "COMPLETED" : (stages[0]?.id ?? "PLANNING"));
}
export function popupStageLabel(
  plan: { stage_id?: string },
  status: string,
  stages: PopupStage[],
): string {
  const id = popupStageId(plan, status, stages);
  if (id === REJECTED_STAGE.id) return REJECTED_STAGE.label;
  return stages.find((s) => s.id === id)?.label ?? id;
}

/** 팝업 단계 점 색 — 주문 상태와 같은 팔레트를 단계 순서대로 쓰고, 마지막 COMPLETED는 주문 COMPLETED와 같은 짙은 색. */
const STAGE_PALETTE = ["#9ca3af", "#60a5fa", "#a78bfa", "#fb923c", "#fbbf24", "#34d399"];
export function popupStageColor(stages: PopupStage[], id: string): string {
  if (id === "COMPLETED") return "#374151";
  if (id === REJECTED_STAGE.id) return REJECTED_COLOR;
  const index = stages.findIndex((s) => s.id === id);
  return index < 0 ? "#9ca3af" : (STAGE_PALETTE[index % STAGE_PALETTE.length] ?? "#9ca3af");
}
