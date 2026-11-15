import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentUserId, pilotSettingsQuery, resolvedOrderProductLines, type OrderProductLine } from "@/lib/queries";
import { inputClass, buttonClass, primaryButtonClass } from "./ui";

export function OrderProductLineSettings() {
  const settings = useQuery(pilotSettingsQuery());
  const queryClient = useQueryClient();
  const lines = resolvedOrderProductLines(settings.data?.product_lines);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const save = useMutation({
    mutationFn: async (next: OrderProductLine[]) => {
      const user_id = await currentUserId();
      const { error } = await supabase.from("pilot_settings").upsert({
        user_id,
        product_lines: next,
      }, { onConflict: "user_id" });
      if (error) throw error;
      const { data: synced, error: syncError } = await supabase.functions.invoke("sync-product-lines-to-planner");
      if (syncError) throw new Error("PILOT saved, but Planner sync failed: " + syncError.message);
      if (!synced?.ok) throw new Error("PILOT saved, but Planner sync failed: " + (synced?.error ?? "Unknown error"));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot_settings"] });
    },
  });
  const add = () => {
    const label = newName.trim();
    if (!label || lines.some((p) => p.label.toLowerCase() === label.toLowerCase())) return;
    const key = "line_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    save.mutate([...lines, { key, label, active: true }], { onSuccess: () => setNewName("") });
  };
  const rename = (key: string) => {
    const label = draft.trim();
    if (!label || lines.some((p) => p.key !== key && p.label.toLowerCase() === label.toLowerCase())) return;
    save.mutate(lines.map((p) => p.key === key ? { ...p, label } : p), { onSuccess: () => setEditing(null) });
  };
  const toggle = (key: string) => {
    save.mutate(lines.map((p) => p.key === key ? { ...p, active: !p.active } : p));
  };
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">
      ORDERS → PRODUCTION DETAIL의 PRODUCT LINE 선택지를 관리합니다. 이름 변경 시 기존 주문의 연결은 유지됩니다.
      사용하지 않는 라인은 비활성화해 새 주문 선택지에서 숨길 수 있습니다.
    </p>
    <ul className="divide-y divide-border border border-border bg-card">
      {lines.map((p) => <li key={p.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
        {editing === p.key ? <>
          <input className={inputClass + " min-w-0 flex-1"} value={draft} maxLength={100}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") rename(p.key); }} />
          <button className={primaryButtonClass} type="button" disabled={save.isPending || !draft.trim()} onClick={() => rename(p.key)}>SAVE</button>
          <button className={buttonClass} type="button" onClick={() => setEditing(null)}>CANCEL</button>
        </> : <>
          <span className={`min-w-0 flex-1 text-sm ${p.active ? "" : "text-muted-foreground"}`}>{p.label}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{p.active ? "ACTIVE" : "INACTIVE"}</span>
          <button className={buttonClass} type="button" disabled={save.isPending} onClick={() => { setEditing(p.key); setDraft(p.label); }}>RENAME</button>
          <button className={buttonClass} type="button" disabled={save.isPending} onClick={() => toggle(p.key)}>{p.active ? "DISABLE" : "ENABLE"}</button>
        </>}
      </li>)}
    </ul>
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <input className={inputClass + " min-w-44 flex-1"} placeholder="NEW PRODUCT LINE NAME" maxLength={100} value={newName} onChange={(e) => setNewName(e.target.value)}/>
      <button className={primaryButtonClass} type="submit" disabled={save.isPending || !newName.trim()}>+ ADD LINE</button>
    </form>
    {save.isError && <p role="alert" className="text-xs text-destructive">{(save.error as Error).message}</p>}
    <p className="font-mono text-[10px] text-muted-foreground">PRODUCT LINE은 제품(Product)과 별개인 사업 라인입니다. WANN Planner의 라인 카드 목록은 별도 설정이므로 신규 라인의 카드 표시 여부는 WANN에서도 확인해야 합니다.</p>
  </div>;
}
