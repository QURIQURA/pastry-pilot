/** 자동 저장 상태 표시(2026-11-15) — SAVE 버튼 대신 작게 보여준다. 실패하면 이유와 "다시 시도"를 띄운다. */
export function AutosaveStatus({
  saving,
  waiting,
  error,
  onRetry,
  loading = false,
  className = "",
}: {
  saving: boolean;
  waiting: boolean;
  error?: unknown;
  onRetry?: () => void;
  loading?: boolean;
  className?: string;
}) {
  const message = error instanceof Error ? error.message : error ? String(error) : null;
  if (message && !saving && !waiting)
    return (
      <span role="alert" className={`text-[11px] text-destructive ${className}`}>
        저장 실패 — {message}
        {onRetry && (
          <>
            {" "}
            <button type="button" className="underline" onClick={onRetry}>
              다시 시도
            </button>
          </>
        )}
      </span>
    );
  return (
    <span
      aria-live="polite"
      className={`label-caps text-[10px] text-muted-foreground ${className}`}
    >
      {loading ? "LOADING…" : saving ? "저장 중…" : waiting ? "입력 중…" : "✓ 자동 저장됨"}
    </span>
  );
}
