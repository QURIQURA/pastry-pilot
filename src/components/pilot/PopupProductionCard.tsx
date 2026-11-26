import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readPopupPlan } from "@/lib/popup";
import { formatDateTime } from "@/lib/datetime";
import {
  CORE_SLOTS,
  CORE_SLOT_LABELS,
  type CoreSlot,
  workSessionFormulaVersionsQuery,
  workSessionQuery,
  type OrderListRow,
} from "@/lib/queries";
import { invalidateProductionSync } from "@/lib/production-sync";
import { AddFormulaVersionForm } from "./WorkSessionWorkspace";
import { addProductComponentsToSession } from "@/lib/product-session-components";
import { cn } from "@/lib/utils";
import {
  ProductionComponentTable,
  ProductionOrderHeader,
  productionOrderStatusClass,
  productionTableButtonClass,
} from "./ProductionComponentTable";
import { PopupOrderStageSelect } from "./PopupStageSelect";

export function PopupProductionCard({ order }: { order: OrderListRow }) {
  const plan = readPopupPlan(order.popup_plan);
  return (
    <section className="space-y-3 border border-border bg-card p-3">
      <ProductionOrderHeader
        number={order.order_number}
        title={
          <Link
            className="text-sm underline-offset-2 hover:underline"
            to="/orders/$orderId"
            params={{ orderId: order.id }}
          >
            {plan.title}
          </Link>
        }
        meta={[order.pickup_at ? formatDateTime(order.pickup_at) : "일정 미지정", plan.location]
          .filter(Boolean)
          .join(" · ")}
        status={
          <PopupOrderStageSelect order={order} selectClassName={productionOrderStatusClass} />
        }
      />
      {plan.items.map((item) => {
        const title = (
          <>
            <p className="text-sm font-medium">{item.label}</p>
            <p className="text-xs text-muted-foreground">
              준비 {item.ready_quantity}/{item.quantity} {item.unit}
            </p>
          </>
        );
        return item.work_session_id ? (
          <PopupItemProduction
            key={item.id}
            sessionId={item.work_session_id}
            productId={item.product_id}
            title={title}
            readOnly={["COMPLETED", "CANCELLED", "REJECTED"].includes(order.status)}
          />
        ) : (
          <ProductionComponentTable key={item.id} sessionId="" rows={[]} readOnly title={title} />
        );
      })}
      <p className="text-xs text-muted-foreground">
        준비 체크 {plan.checklist.filter((c) => c.done).length}/{plan.checklist.length}
      </p>
      <Link
        className={productionTableButtonClass}
        to="/orders/$orderId"
        params={{ orderId: order.id }}
      >
        POP UP DETAIL · 품목별 세션 준비
      </Link>
    </section>
  );
}
export function PopupItemProduction({
  sessionId,
  productId,
  readOnly,
  title,
}: {
  sessionId: string;
  productId: string;
  readOnly: boolean;
  title?: ReactNode;
}) {
  const client = useQueryClient();
  const rows = useQuery(workSessionFormulaVersionsQuery(sessionId));
  const session = useQuery(workSessionQuery(sessionId));
  const locked = readOnly || session.isLoading || session.isError;
  const [adding, setAdding] = useState<CoreSlot | "ANY" | null>(null);
  // 제품이 연결된 품목은 제품에 저장된 하위 컴포넌트를 세션에 불러온다 — 세션이 비어 있으면 자동으로 한 번,
  // 이후엔 "제품 컴포넌트 불러오기" 버튼으로(이미 있는 건 건너뜀).
  const loadProduct = useMutation({
    mutationFn: () => addProductComponentsToSession(client, sessionId, productId),
    onSettled: () => void invalidateProductionSync(client),
  });
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || !productId || locked || !rows.isSuccess) return;
    autoTried.current = true;
    if ((rows.data ?? []).length === 0) loadProduct.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.isSuccess, locked, productId]);
  return (
    <div className="space-y-2">
      {rows.isError && (
        <p role="alert" className="text-xs text-destructive">
          생산 구성을 불러오지 못했습니다.
        </p>
      )}
      <ProductionComponentTable
        sessionId={sessionId}
        rows={rows.data ?? []}
        readOnly={locked}
        title={title}
        allowFormulaChange
      />
      {!locked && (
        <div className="flex flex-wrap gap-2">
          {productId && (
            <button
              type="button"
              className={productionTableButtonClass}
              disabled={loadProduct.isPending}
              onClick={() => loadProduct.mutate()}
            >
              {loadProduct.isPending ? "불러오는 중…" : "제품 컴포넌트 불러오기"}
            </button>
          )}
          {([...CORE_SLOTS, "ANY"] as const).map((slot) => (
            <button
              key={slot}
              type="button"
              className={cn(productionTableButtonClass, adding === slot && "bg-secondary")}
              onClick={() => setAdding((previous) => (previous === slot ? null : slot))}
            >
              + {slot === "ANY" ? "기타" : CORE_SLOT_LABELS[slot].toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {loadProduct.isError && (
        <p role="alert" className="text-xs text-destructive">
          {(loadProduct.error as Error).message}
        </p>
      )}
      {loadProduct.isSuccess && loadProduct.data === 0 && (rows.data ?? []).length === 0 && (
        <p className="text-xs text-muted-foreground">
          이 제품에 불러올 수 있는 하위 컴포넌트가 없어요(컴포넌트 연결·레시피·기법 분류 확인).
        </p>
      )}
      {adding && !locked && (
        <AddFormulaVersionForm
          sessionId={sessionId}
          nextSort={rows.data?.length ?? 0}
          key={adding}
          slot={adding === "ANY" ? null : adding}
          addOnSelect
          productId={session.data?.product_id ?? (productId || null)}
          productSizeId={session.data?.product_size_id ?? null}
          cakeSizeId={session.data?.cake_size_id ?? null}
          onDone={() => {
            setAdding(null);
            void invalidateProductionSync(client);
          }}
        />
      )}
    </div>
  );
}
