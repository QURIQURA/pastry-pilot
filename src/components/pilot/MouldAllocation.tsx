import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WorkSessionFormulaVersionRow } from "@/lib/queries";
import { equalMouldSplit, formatMouldSplit, matchesMouldSplit } from "@/lib/production-quantity";
import { buttonClass, inputClass } from "./ui";

export function MouldAllocation({
  row,
  batchGrams,
  label,
  mouldLabel,
}: {
  row: WorkSessionFormulaVersionRow;
  batchGrams: number;
  label: string;
  mouldLabel: string;
}) {
  const queryClient = useQueryClient();
  const count = Number(row.mould_qty);
  const equal = equalMouldSplit(batchGrams, count);
  const saved = row.batter_split_g;
  const validSaved = saved != null && matchesMouldSplit(saved, count, batchGrams);
  const initial = validSaved ? saved : equal;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const weights = draft.map(Number);
  const valid = matchesMouldSplit(weights, count, batchGrams);
  const save = useMutation({
    mutationFn: async (values: number[] | null) => {
      if (values && !matchesMouldSplit(values, count, batchGrams))
        throw new Error("몰드별 중량 합계가 전체 반죽 중량과 같아야 해요.");
      const { data, error } = await supabase
        .from("work_session_formula_versions")
        .update({ batter_split_g: values })
        .eq("id", row.id)
        .eq("updated_at", row.updated_at)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("작업 기록이 변경됐어요. 최신 값을 불러온 뒤 다시 시도해 주세요.");
    },
    onSuccess: () => setEditing(false),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["work_session_formula_versions", row.work_session_id],
      }),
  });
  if (!equal.length) return null;
  return (
    <div className="space-y-1 border-b border-border/50 py-1">
      <p className="font-mono">
        {label} · {mouldLabel} · 몰드 {count}개 · 전체 {Math.round(batchGrams)}g
      </p>
      {saved && !validSaved && (
        <p className="text-amber-700">배합 또는 몰드 수가 변경됐어요. 분할을 다시 확인해 주세요.</p>
      )}
      {editing ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !save.isPending) save.mutate(weights);
          }}
        >
          {draft.map((weight, index) => (
            <label key={index}>
              {index + 1}번 (g)
              <input
                className={`${inputClass} w-20`}
                type="number"
                min={1}
                step={1}
                value={weight}
                disabled={save.isPending}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((previous) =>
                    previous.map((item, position) => (position === index ? value : item)),
                  );
                }}
              />
            </label>
          ))}
          <span>합계 {weights.reduce((sum, grams) => sum + grams, 0)}g</span>
          <button className={buttonClass} disabled={!valid || save.isPending}>
            저장
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={save.isPending}
            onClick={() => setEditing(false)}
          >
            취소
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{formatMouldSplit(initial)}</span>
          {count > 1 && (
            <button
              type="button"
              className="underline"
              onClick={() => {
                save.reset();
                setDraft(initial.map(String));
                setEditing(true);
              }}
            >
              분할 수정
            </button>
          )}
          {saved && (
            <button
              type="button"
              className="underline"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              균등 분할로 복원
            </button>
          )}
        </div>
      )}
      {save.error && (
        <p role="alert" className="text-destructive">
          {save.error.message}
        </p>
      )}
    </div>
  );
}
