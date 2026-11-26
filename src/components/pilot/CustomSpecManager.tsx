import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  cakeSizeLayerComponentsQuery,
  cakeSizeLayersQuery,
  cakeSizesQuery,
  currentUserId,
  formulasQuery,
  mouldsQuery,
  type CakeSizeLayer,
  type CakeSizeLayerComponent,
} from "@/lib/queries";
import { candidateMoulds } from "@/lib/mould-match";
import { mouldAbbr } from "@/lib/component-size";
import { cmToMm, mmToCm } from "@/lib/product-size";
import { CAKE_SIZE_INCHES } from "@/lib/cake-size";
import {
  LAYER_COMPONENT_SLOTS,
  LAYER_SHAPES,
  customSpecSummary,
  layerSizeText,
} from "@/lib/custom-spec";
import { SectionCard, buttonClass, inputClass, selectClass } from "./ui";

const STORAGE_KEY = "pilot.customSpec.selected";
const DEFAULT_SET = ["SHEET", "CREAM", "INSERT"] as const;

/**
 * 2026-11-26 (Issue #69): SETTINGS > 공용 완성 규격 하위 CUSTOM.
 * 규칙 없는 멀티레이어 규격(예: Ø10″ 스파이스 + Ø6″ 딸기 시폰 + 진저브레드 쿠키 하늘 배경)을
 * cake_sizes(kind=CUSTOM) 한 행 + 레이어(cake_size_layers) + 레이어별 컴포넌트 줄(cake_size_layer_components)로 저장한다.
 * kind=CUSTOM이라 주문·세션의 공용 완성 규격 드롭다운에 그대로 나타난다.
 */
export function CustomSpecManager() {
  const queryClient = useQueryClient();
  const sizes = useQuery(cakeSizesQuery());
  const layers = useQuery(cakeSizeLayersQuery());
  const parts = useQuery(cakeSizeLayerComponentsQuery());
  const formulas = useQuery(formulasQuery());
  const moulds = useQuery(mouldsQuery());
  const usage = useQuery({
    queryKey: ["cake_size_usage"],
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("cake_size_id");
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of data ?? [])
        if (r.cake_size_id) map[r.cake_size_id] = (map[r.cake_size_id] ?? 0) + 1;
      return map;
    },
  });

  const specs = (sizes.data ?? [])
    .filter((s) => s.kind === "CUSTOM")
    .sort((a, b) => a.name.localeCompare(b.name));
  const [selectedId, setSelectedId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const selected = specs.find((s) => s.id === selectedId) ?? null;
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, selectedId);
    } catch {
      /* 저장 불가 환경은 무시 */
    }
  }, [selectedId]);

  const layersOf = (sizeId: string) =>
    (layers.data ?? [])
      .filter((l) => l.cake_size_id === sizeId)
      .sort((a, b) => a.sort_order - b.sort_order);
  const partsOf = (layerId: string) =>
    (parts.data ?? [])
      .filter((p) => p.layer_id === layerId)
      .sort((a, b) => a.sort_order - b.sort_order);

  const invalidate = async () => {
    await Promise.all(
      ["cake_sizes", "cake_size_layers", "cake_size_layer_components", "cake_size_usage"].map(
        (key) => queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
  };

  const createSpec = useMutation({
    mutationFn: async () => {
      const user_id = await currentUserId();
      const { data, error } = await supabase
        .from("cake_sizes")
        .insert({
          kind: "CUSTOM",
          name: "New custom",
          shape: null,
          size_inch: null,
          user_id,
          sort_order: (sizes.data?.length ?? 0) + 1,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: async (id) => {
      await invalidate();
      setSelectedId(id);
    },
  });

  const updateSpec = useMutation({
    mutationFn: async (v: {
      id: string;
      patch: { name?: string; servings?: number | null; notes?: string | null };
    }) => {
      if (v.patch.name !== undefined && !v.patch.name.trim()) throw new Error("이름을 입력하세요.");
      const { error } = await supabase
        .from("cake_sizes")
        .update({ ...v.patch, updated_at: new Date().toISOString() })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeSpec = useMutation({
    mutationFn: async (id: string) => {
      const results = await Promise.all(
        (["orders", "work_sessions", "product_sizes"] as const).map((table) =>
          supabase.from(table).select("id", { count: "exact", head: true }).eq("cake_size_id", id),
        ),
      );
      for (const r of results) if (r.error) throw r.error;
      if (results.some((r) => (r.count ?? 0) > 0))
        throw new Error("오더·세션·제품에서 사용 중인 규격은 삭제할 수 없습니다.");
      const { error } = await supabase.from("cake_sizes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      setSelectedId("");
      await invalidate();
    },
  });

  const addLayer = useMutation({
    mutationFn: async (sizeId: string) => {
      const user_id = await currentUserId();
      const existing = layersOf(sizeId);
      const { error } = await supabase.from("cake_size_layers").insert({
        user_id,
        cake_size_id: sizeId,
        sort_order: existing.length,
        label: existing.length === 0 ? "Bottom" : `Layer ${existing.length + 1}`,
        shape: "ROUND",
        size_inch: existing.length === 0 ? 10 : 6,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateLayer = useMutation({
    mutationFn: async (v: { id: string; patch: Partial<CakeSizeLayer> }) => {
      for (const key of ["length_mm", "width_mm", "height_mm"] as const) {
        const value = v.patch[key];
        if (value != null && (!Number.isFinite(value) || value <= 0))
          throw new Error("치수는 양수 cm로 입력하세요.");
      }
      const { error } = await supabase
        .from("cake_size_layers")
        .update({ ...v.patch, updated_at: new Date().toISOString() })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const moveLayer = useMutation({
    mutationFn: async (v: { sizeId: string; index: number; dir: -1 | 1 }) => {
      const list = [...layersOf(v.sizeId)];
      const target = v.index + v.dir;
      const a = list[v.index];
      const b = list[target];
      if (!a || !b) return;
      list[v.index] = b;
      list[target] = a;
      const results = await Promise.all(
        list.map((l, i) =>
          l.sort_order === i
            ? Promise.resolve({ error: null })
            : supabase.from("cake_size_layers").update({ sort_order: i }).eq("id", l.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: invalidate,
  });

  const removeLayer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cake_size_layers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const addParts = useMutation({
    mutationFn: async (v: { layer: CakeSizeLayer; slots: readonly string[] }) => {
      const user_id = await currentUserId();
      const start = partsOf(v.layer.id).length;
      // 시트 줄은 레이어와 모양·사이즈가 같은 몰드가 하나뿐이면 그 몰드를 미리 넣는다.
      const match =
        v.layer.shape && v.layer.shape !== "FREE"
          ? candidateMoulds(
              {
                shape: v.layer.shape,
                size_inch: v.layer.size_inch,
                length_mm: v.layer.length_mm,
                width_mm: v.layer.width_mm,
              },
              moulds.data ?? [],
            )
          : [];
      const { error } = await supabase.from("cake_size_layer_components").insert(
        v.slots.map((slot, i) => ({
          user_id,
          layer_id: v.layer.id,
          slot,
          sort_order: start + i,
          mould_id: slot === "SHEET" && match.length === 1 ? match[0]!.id : null,
        })),
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updatePart = useMutation({
    mutationFn: async (v: { id: string; patch: Partial<CakeSizeLayerComponent> }) => {
      if (
        v.patch.mould_qty != null &&
        (!Number.isFinite(v.patch.mould_qty) || v.patch.mould_qty <= 0)
      )
        throw new Error("몰드 개수는 0보다 커야 합니다.");
      if (v.patch.target_g != null && (!Number.isFinite(v.patch.target_g) || v.patch.target_g < 0))
        throw new Error("목표 g은 0 이상으로 입력하세요.");
      const { error } = await supabase
        .from("cake_size_layer_components")
        .update({ ...v.patch, updated_at: new Date().toISOString() })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removePart = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cake_size_layer_components").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const errors = [
    createSpec,
    updateSpec,
    removeSpec,
    addLayer,
    updateLayer,
    moveLayer,
    removeLayer,
    addParts,
    updatePart,
    removePart,
  ]
    .map((m) => m.error)
    .filter(Boolean) as Error[];
  const loadError = (layers.error ?? parts.error) as Error | null;

  const formulaOptions = [...(formulas.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const mouldOptions = moulds.data ?? [];
  const specLayers = selected ? layersOf(selected.id) : [];
  const used = selected ? (usage.data?.[selected.id] ?? 0) : 0;

  const numberInput = (
    value: number | string | null,
    onCommit: (next: number | null) => void,
    opts: { placeholder: string; width: string; step?: string; toCm?: boolean },
  ) => (
    <input
      type="number"
      inputMode="decimal"
      min="0"
      step={opts.step ?? "1"}
      className={`${inputClass} ${opts.width} text-right`}
      placeholder={opts.placeholder}
      defaultValue={value == null ? "" : opts.toCm ? mmToCm(Number(value)) : Number(value)}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const next = raw ? (opts.toCm ? cmToMm(Number(raw)) : Number(raw)) : null;
        if (next !== (value == null ? null : Number(value))) onCommit(next);
      }}
    />
  );

  return (
    <SectionCard title="CUSTOM — 멀티레이어 규격">
      <p className="mb-3 font-mono text-[11px] text-muted-foreground">
        디자인마다 규칙 없이 쌓는 규격이에요(예: Ø10″ 스파이스 + Ø6″ 딸기 시폰 + 진저브레드 쿠키).
        레이어는 바닥부터 위로, 레이어마다 시트·크림·인서트 같은 컴포넌트 세트를 넣고 각 줄에
        레시피와 몰드(× 개수) 또는 목표 g을 연결하세요. 만든 규격은 주문의 공용 완성 규격 목록에
        CUSTOM으로 나타나요.
      </p>
      {(errors.length > 0 || loadError) && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {loadError
            ? `레이어 표를 불러오지 못했어요 — 마이그레이션 적용 여부를 확인하세요: ${loadError.message}`
            : errors[0]!.message}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="커스텀 규격 선택"
          className={`${selectClass} min-w-[14rem] flex-1`}
          value={selected?.id ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">— CUSTOM 규격 선택 ({specs.length}) —</option>
          {specs.map((s) => {
            const summary = customSpecSummary(layersOf(s.id));
            return (
              <option key={s.id} value={s.id}>
                {s.name}
                {summary ? ` · ${summary}` : ""}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          className={buttonClass}
          disabled={createSpec.isPending}
          onClick={() => createSpec.mutate()}
        >
          + NEW CUSTOM
        </button>
      </div>

      {selected && (
        <div key={selected.id} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-caps border border-foreground px-1.5 py-0.5 text-[10px]">
              CUSTOM
            </span>
            <input
              aria-label="커스텀 규격 이름"
              className={`${inputClass} min-w-[12rem] flex-1`}
              defaultValue={selected.name}
              placeholder="예: Space gingerbread 3-layer"
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== selected.name)
                  updateSpec.mutate({ id: selected.id, patch: { name: next } });
              }}
            />
            <div className="flex items-center gap-1">
              {numberInput(
                selected.servings,
                (next) => updateSpec.mutate({ id: selected.id, patch: { servings: next } }),
                { placeholder: "servings", width: "!w-20" },
              )}
              <span className="label-caps text-[10px] text-muted-foreground">SERVINGS</span>
            </div>
            <span className="label-caps text-[10px] text-muted-foreground">{used} ORDERS</span>
            <button
              type="button"
              className={buttonClass}
              disabled={used > 0 || removeSpec.isPending}
              title={used > 0 ? "주문에 사용 중인 규격은 삭제할 수 없습니다." : undefined}
              onClick={() => {
                if (confirm("Delete this unused custom spec and its layers?"))
                  removeSpec.mutate(selected.id);
              }}
            >
              DELETE
            </button>
          </div>
          <textarea
            aria-label="디자인 메모"
            className={`${inputClass} min-h-[3rem]`}
            placeholder="디자인 메모 — 예: 하늘 배경, 진저브레드 하우스, 로켓 쿠키"
            defaultValue={selected.notes ?? ""}
            onBlur={(e) => {
              const next = e.target.value.trim() || null;
              if (next !== (selected.notes ?? null))
                updateSpec.mutate({ id: selected.id, patch: { notes: next } });
            }}
          />
          <p className="font-mono text-xs">
            {specLayers.length > 0 ? customSpecSummary(specLayers) : "레이어를 추가하세요"}
          </p>

          <ol className="divide-y divide-border border border-border">
            {specLayers.map((layer, index) => {
              const layerParts = partsOf(layer.id);
              return (
                <li key={layer.id} className="space-y-2 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        className="label-caps px-1 text-[10px] leading-none hover:bg-secondary disabled:opacity-30"
                        disabled={index === specLayers.length - 1 || moveLayer.isPending}
                        onClick={() => moveLayer.mutate({ sizeId: selected.id, index, dir: 1 })}
                        aria-label="Move up (toward top)"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="label-caps px-1 text-[10px] leading-none hover:bg-secondary disabled:opacity-30"
                        disabled={index === 0 || moveLayer.isPending}
                        onClick={() => moveLayer.mutate({ sizeId: selected.id, index, dir: -1 })}
                        aria-label="Move down (toward bottom)"
                      >
                        ▼
                      </button>
                    </div>
                    <span className="label-caps text-[10px] text-muted-foreground">
                      L{index + 1}
                      {index === 0 ? " · BOTTOM" : ""}
                    </span>
                    <input
                      aria-label="레이어 이름"
                      className={`${inputClass} !w-40`}
                      defaultValue={layer.label}
                      placeholder="예: Spice base"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next !== layer.label)
                          updateLayer.mutate({ id: layer.id, patch: { label: next } });
                      }}
                    />
                    <select
                      aria-label="레이어 모양"
                      className={`${selectClass} !w-32`}
                      value={layer.shape ?? ""}
                      onChange={(e) =>
                        updateLayer.mutate({
                          id: layer.id,
                          patch: { shape: e.target.value || null },
                        })
                      }
                    >
                      <option value="">— SHAPE —</option>
                      {LAYER_SHAPES.map((sh) => (
                        <option key={sh} value={sh}>
                          {sh}
                        </option>
                      ))}
                    </select>
                    {(layer.shape === "ROUND" || layer.shape === "SQUARE") && (
                      <select
                        aria-label="레이어 인치"
                        className={`${selectClass} !w-24`}
                        value={layer.size_inch ?? ""}
                        onChange={(e) =>
                          updateLayer.mutate({
                            id: layer.id,
                            patch: { size_inch: e.target.value ? Number(e.target.value) : null },
                          })
                        }
                      >
                        <option value="">— INCH —</option>
                        {CAKE_SIZE_INCHES.map((n) => (
                          <option key={n} value={n}>
                            {n}&quot;
                          </option>
                        ))}
                      </select>
                    )}
                    {layer.shape === "RECTANGLE" && (
                      <>
                        {numberInput(
                          layer.length_mm,
                          (next) =>
                            updateLayer.mutate({ id: layer.id, patch: { length_mm: next } }),
                          { placeholder: "L cm", width: "!w-20", step: "0.1", toCm: true },
                        )}
                        {numberInput(
                          layer.width_mm,
                          (next) => updateLayer.mutate({ id: layer.id, patch: { width_mm: next } }),
                          { placeholder: "W cm", width: "!w-20", step: "0.1", toCm: true },
                        )}
                      </>
                    )}
                    <div className="flex items-center gap-1">
                      {numberInput(
                        layer.height_mm,
                        (next) => updateLayer.mutate({ id: layer.id, patch: { height_mm: next } }),
                        { placeholder: "H", width: "!w-20", step: "0.1", toCm: true },
                      )}
                      <span className="label-caps text-[10px] text-muted-foreground">CM H</span>
                    </div>
                    <span className="font-mono text-xs">{layerSizeText(layer)}</span>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={removeLayer.isPending}
                      onClick={() => {
                        if (confirm("Delete this layer and its components?"))
                          removeLayer.mutate(layer.id);
                      }}
                    >
                      DELETE LAYER
                    </button>
                  </div>

                  <div className="ml-6 space-y-1">
                    {layerParts.map((part) => (
                      <div key={part.id} className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label="컴포넌트 역할"
                          className={`${selectClass} !w-28`}
                          value={part.slot}
                          onChange={(e) =>
                            updatePart.mutate({ id: part.id, patch: { slot: e.target.value } })
                          }
                        >
                          {LAYER_COMPONENT_SLOTS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="레시피"
                          className={`${selectClass} min-w-[12rem] flex-1`}
                          value={part.formula_id ?? ""}
                          onChange={(e) =>
                            updatePart.mutate({
                              id: part.id,
                              patch: { formula_id: e.target.value || null },
                            })
                          }
                        >
                          <option value="">— RECIPE —</option>
                          {formulaOptions.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="몰드"
                          className={`${selectClass} !w-32`}
                          value={part.mould_id ?? ""}
                          onChange={(e) =>
                            updatePart.mutate({
                              id: part.id,
                              patch: { mould_id: e.target.value || null },
                            })
                          }
                        >
                          <option value="">— MOULD —</option>
                          {mouldOptions.map((m) => (
                            <option key={m.id} value={m.id}>
                              {mouldAbbr(m)}
                              {m.reference_weight_g ? ` · ${m.reference_weight_g}g` : ""}
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1">
                          <span className="label-caps text-[10px] text-muted-foreground">×</span>
                          {numberInput(
                            part.mould_qty,
                            (next) =>
                              updatePart.mutate({ id: part.id, patch: { mould_qty: next ?? 1 } }),
                            { placeholder: "1", width: "!w-16", step: "0.5" },
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {numberInput(
                            part.target_g,
                            (next) => updatePart.mutate({ id: part.id, patch: { target_g: next } }),
                            { placeholder: "g", width: "!w-20" },
                          )}
                          <span className="label-caps text-[10px] text-muted-foreground">
                            TARGET g
                          </span>
                        </div>
                        <input
                          aria-label="메모"
                          className={`${inputClass} !w-40`}
                          defaultValue={part.notes ?? ""}
                          placeholder="memo"
                          onBlur={(e) => {
                            const next = e.target.value.trim() || null;
                            if (next !== (part.notes ?? null))
                              updatePart.mutate({ id: part.id, patch: { notes: next } });
                          }}
                        />
                        <button
                          type="button"
                          className="label-caps px-1 text-[10px] text-muted-foreground hover:text-destructive"
                          disabled={removePart.isPending}
                          onClick={() => removePart.mutate(part.id)}
                          aria-label="Remove component"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      {layerParts.length === 0 && (
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={addParts.isPending}
                          onClick={() => addParts.mutate({ layer, slots: DEFAULT_SET })}
                        >
                          + SHEET · CREAM · INSERT SET
                        </button>
                      )}
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={addParts.isPending}
                        onClick={() => addParts.mutate({ layer, slots: ["SHEET"] })}
                      >
                        + COMPONENT
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className={buttonClass}
            disabled={addLayer.isPending}
            onClick={() => addLayer.mutate(selected.id)}
          >
            + ADD LAYER
          </button>
        </div>
      )}
    </SectionCard>
  );
}
