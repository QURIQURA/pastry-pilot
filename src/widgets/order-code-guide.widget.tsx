import type { WidgetDef } from "./types";

/**
 * Canonical YEON OS numbering contract.
 * SH is a cake-order identity, NOT a week number or an item quantity.
 * REQ / ORD identify intake origin; SND identifies a popup event.
 * Legacy SH-010.2 is historical only; do not derive current order counts from it.
 * See docs/ORDER_IDENTITY.md. Keep this widget in sync with the migration.
 */
function OrderCodeGuideWidget() {
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        One cake order = one SH master number. Numbers are sequential, not week-based.
      </p>
      <dl className="divide-y divide-border border border-border">
        {[
          ["SH-0001", "MASTER · unique cake order (PILOT)"],
          ["ORD-0001", "DIRECT · manually received order (SHCS reference)"],
          ["REQ-0001", "WEB · website request (SHCS reference)"],
          ["SND-001", "POPUP · event/project, not an individual order"],
        ].map(([code, meaning]) => (
          <div key={code} className="flex flex-wrap gap-x-3 gap-y-1 px-2 py-2">
            <dt className="min-w-[82px] font-mono font-semibold tabular-nums">{code}</dt>
            <dd className="flex-1 text-muted-foreground">{meaning}</dd>
          </div>
        ))}
      </dl>
      <p className="leading-relaxed text-muted-foreground">
        A cake sold at a popup keeps its own SH + ORD/REQ reference and can also
        link to SND. Walk-up item sales belong to popup sales records, not
        individual SH orders. Legacy SH week.suffix codes remain searchable
        historical references; never reuse or reinterpret them.
      </p>
    </div>
  );
}

export const orderCodeGuideWidget: WidgetDef = {
  id: "order-code-guide",
  title: "ORDER CODE GUIDE",
  size: "small",
  component: OrderCodeGuideWidget,
};
