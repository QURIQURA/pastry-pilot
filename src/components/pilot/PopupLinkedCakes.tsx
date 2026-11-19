import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionCard, buttonClass, selectClass } from "./ui";

type LinkedCake = { cake_order_id: string; order_number: string; customer_name: string | null };
type CakeChoice = { id: string; order_number: string; recipient: string | null };

export function PopupLinkedCakes({ popupId }: { popupId: string }) {
  const qc = useQueryClient();
  const [cakeId, setCakeId] = useState("");
  const [message, setMessage] = useState("");
  const linked = useQuery({
    queryKey: ["popup-linked-cakes", popupId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("shcs_popup_cake_links" as never, { p_popup_id: popupId } as never);
      if (error) throw error;
      return (data ?? []) as LinkedCake[];
    },
  });
  const choices = useQuery({
    queryKey: ["popup-cake-choices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("id,order_number,recipient").eq("order_kind", "CAKE").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as CakeChoice[];
    },
  });
  const mutate = useMutation({
    mutationFn: async ({ id, link }: { id: string; link: boolean }) => {
      const { error } = await supabase.rpc("shcs_set_popup_cake_link" as never, { p_popup_id: popupId, p_cake_id: id, p_link: link } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      setCakeId("");
      setMessage("");
      await qc.invalidateQueries({ queryKey: ["popup-linked-cakes", popupId] });
    },
    onError: (error) => setMessage(error.message),
  });
  const available = (choices.data ?? []).filter(c => !(linked.data ?? []).some(l => l.cake_order_id === c.id));
  return (
    <SectionCard title="LINKED CAKE ORDERS · SH">
      <p className="text-xs text-muted-foreground">Link confirmed cake orders to this SND event. Date alone never creates a link; cake revenue must not be counted twice.</p>
      {linked.isLoading ? <p className="text-xs">Loading linked orders…</p> : linked.isError ? <p className="text-xs text-destructive">{linked.error.message}</p> : (
        <div className="space-y-2">
          {(linked.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No cake orders linked yet.</p>}
          {(linked.data ?? []).map(l => <div key={l.cake_order_id} className="flex items-center justify-between gap-3 text-sm">
            <span><strong>{l.order_number}</strong> · {l.customer_name ?? "Customer not recorded"}</span>
            <button type="button" className={buttonClass} disabled={mutate.isPending} onClick={() => mutate.mutate({ id: l.cake_order_id, link: false })}>Unlink</button>
          </div>)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <select aria-label="Choose cake order" className={selectClass} value={cakeId} onChange={e => setCakeId(e.target.value)}>
          <option value="">Choose confirmed SH order…</option>
          {available.map(c => <option key={c.id} value={c.id}>{c.order_number} · {c.recipient ?? "Cake"}</option>)}
        </select>
        <button type="button" className={buttonClass} disabled={!cakeId || mutate.isPending} onClick={() => mutate.mutate({ id: cakeId, link: true })}>Link cake</button>
      </div>
      {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
    </SectionCard>
  );
}
