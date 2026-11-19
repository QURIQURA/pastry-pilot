/* eslint-disable prettier/prettier -- layout formatting only */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetDef } from "./types";

type Reconciliation = {
 cake_orders: number;
 recorded_paid_orders: number;
 recorded_paid_amount: number;
 unpaid_orders: number;
 unpaid_amount: number;
 unknown_payment_orders: number;
 unknown_payment_amount: number;
 missing_price_orders: number;
 popup_events: number;
 confirmed_popup_cake_links: number;
 settlement_verified: boolean;
};
type QueueRow = { order_id: string; order_number: string; price: number | null; payment_status: string | null; missing_price: boolean; missing_payment_status: boolean };
const aud = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
function SalesReconciliationWidget() {
 const q = useQuery({
  queryKey: ["shcs-sales-reconciliation"],
  queryFn: async () => {
   const { data, error } = await supabase.rpc("shcs_sales_reconciliation" as never);
   if (error) throw error;
   return data as Reconciliation;
  },
  staleTime: 60000,
 });
 const queue = useQuery({
  queryKey: ["shcs-sales-reconciliation-queue"],
  queryFn: async () => {
   const { data, error } = await supabase.rpc("shcs_sales_reconciliation_queue" as never);
   if (error) throw error;
   return (data ?? []) as QueueRow[];
  },
  staleTime: 60000,
 });
 if (q.isLoading) return <p className="text-xs text-muted-foreground">Loading recorded payment statuses…</p>;
 if (q.isError || !q.data) return <p className="text-xs text-destructive">Sales reconciliation unavailable: {q.error?.message ?? "No data"}</p>;
 const d = q.data;
 return <div className="space-y-2 text-xs">
  <div className="flex justify-between"><span>Recorded paid in full · {d.recorded_paid_orders} cakes</span><strong>{aud(d.recorded_paid_amount)}</strong></div>
  <div className="flex justify-between"><span>Unpaid · {d.unpaid_orders} cakes</span><span>{aud(d.unpaid_amount)}</span></div>
  <div className="flex justify-between"><span>Payment status missing · {d.unknown_payment_orders}</span><span>{aud(d.unknown_payment_amount)}</span></div>
  <div className="flex justify-between"><span>Missing prices</span><strong>{d.missing_price_orders}</strong></div>
  <div className="flex justify-between"><span>Popup events / confirmed SH links</span><span>{d.popup_events} / {d.confirmed_popup_cake_links}</span></div>
  <details className="border-t border-border pt-2">
   <summary className="cursor-pointer font-semibold">REVIEW QUEUE · {queue.data?.length ?? "…"} orders</summary>
   {queue.isError ? <p className="text-destructive">Unable to load review queue: {queue.error.message}</p> : (
    <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
     {(queue.data ?? []).map((r) => (
      <div key={r.order_id} className="flex justify-between gap-2 border-b border-border py-1">
       <span className="font-mono">{r.order_number}</span>
       <span className="text-right text-muted-foreground">{r.missing_price ? "PRICE MISSING" : aud(Number(r.price))}{r.missing_payment_status ? " · PAYMENT UNKNOWN" : ""}</span>
      </div>
     ))}
     {!queue.isLoading && queue.data?.length === 0 && <p>Nothing to review.</p>}
    </div>
   )}
  </details>
  <p className="border-t border-border pt-2 text-muted-foreground">Recorded order statuses only — not verified bank settlement, profit or popup walk-up revenue. Each SH counted once.</p>
 </div>;
}
export const salesReconciliationWidget: WidgetDef = {
 id: "sales-reconciliation",
 title: "SALES · RECONCILIATION",
 size: "small",
 component: SalesReconciliationWidget,
};
