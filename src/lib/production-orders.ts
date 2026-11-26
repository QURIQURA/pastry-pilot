/** Build from orders, so missing sessions/components can never silently remove an order card. */
export function buildProductionOrderCards<
  O extends {
    id: string;
    status: string;
    order_number: string;
    pickup_at: string | null;
    event_date: string | null;
  },
  R extends { order: { id: string } },
  S extends { id: string; order_id: string | null; status: string },
>(orders: O[], components: R[], sessions: S[], completed: boolean) {
  return orders
    .filter((o) => o.status !== "REJECTED" && (o.status === "COMPLETED") === completed)
    .map((order) => {
      const linked = sessions.filter((s) => s.order_id === order.id && s.status !== "CANCELLED");
      return {
        order,
        rows: components.filter((r) => r.order.id === order.id),
        session: linked.length === 1 ? linked[0]! : null,
        ambiguousSession: linked.length > 1,
      };
    })
    .sort((a, b) => {
      const dateA = a.order.pickup_at ?? a.order.event_date;
      const dateB = b.order.pickup_at ?? b.order.event_date;
      // Production progress must never reorder cards. Sort by delivery/pickup only.
      // Unscheduled orders come last; completed history stays newest first.
      if (!dateA && dateB) return 1;
      if (dateA && !dateB) return -1;
      const byDate = (dateA ?? "").localeCompare(dateB ?? "");
      if (byDate !== 0) return completed ? -byDate : byDate;
      return a.order.order_number.localeCompare(b.order.order_number) ||
        a.order.id.localeCompare(b.order.id);
    });
}
