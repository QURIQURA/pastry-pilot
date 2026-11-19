import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const ORDER_DETAIL_TABS = ["VISUALS", "PRODUCTION DETAIL", "ORDER DETAIL"] as const;
export type OrderDetailTab = (typeof ORDER_DETAIL_TABS)[number];

export function OrderDetailLayout({
  identity,
  actions,
  tab,
  onTabChange,
  children,
}: {
  identity: ReactNode;
  actions: ReactNode;
  tab: OrderDetailTab;
  onTabChange: (tab: OrderDetailTab) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            to="/orders"
            className="label-caps text-xs text-muted-foreground hover:text-foreground"
          >
            ← ORDERS
          </Link>
          {identity}
        </div>
        {actions}
      </header>
      <nav aria-label="Order details" className="flex flex-wrap gap-2 border-b border-border">
        {ORDER_DETAIL_TABS.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={item === tab ? "page" : undefined}
            onClick={() => onTabChange(item)}
            className={`label-caps -mb-px border-b-2 px-3 py-2 text-xs transition-colors ${
              item === tab
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {item}
          </button>
        ))}
      </nav>
      {children}
    </div>
  );
}
