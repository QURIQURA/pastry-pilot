import { invalidateProductionSync } from "@/lib/production-sync";
import { PopupProductionCard } from "./PopupProductionCard";
import { toast } from "sonner";
import { ProductionOrderSizeEditor } from "./ProductionOrderSizeEditor";
import {
  ProductionComponentTable,
  ProductionOrderHeader,
  productionOrderStatusClass,
} from "./ProductionComponentTable";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CORE_SLOTS,
  CORE_SLOT_LABELS,
  dashboardComponentsQuery,
  ORDER_STATUSES,
  orderStatusLabel,
  ordersQuery,
  workSessionsQuery,
  workSessionFormulaVersionsQuery,
  type CoreSlot,
  type DashboardComponentRow,
} from "@/lib/queries";
import { buildProductionOrderCards } from "@/lib/production-orders";
import { formatDelivery } from "@/lib/datetime";
import { ensureWorkSessionForOrder } from "@/lib/work-session";
import { cn } from "@/lib/utils";
import { AddFormulaVersionForm } from "@/components/pilot/WorkSessionWorkspace";
import {
  DashboardComponentCopyForm,
  DashboardComponentNewForm,
} from "@/components/pilot/DashboardComponentCopyForm";
import { CopyWarning, OrderFlagBoxes, useOrderDietaryNames } from "./OrderTitle";
import { buttonClass } from "./ui";
import { supabase } from "@/integrations/supabase/client";
import { syncOrderDeliveryToPlanner } from "@/lib/order-planner-sync";

/**
 * PRODUCTION > ORDERS 탭(2026-10-22 사용자 요청) — 진행 중인 오더(완료 전) 전체 목록.
 * 여기서 오더에 컴포넌트(TASK)를 지정한다: 기존 컴포넌트 지정 / 기존 컴포넌트를 복사해 새로 만들기(최신 버전 하나만) /
 * WORK SESSION이 없는 오더는 바로 세션 만들기. 컴포넌트가 지정되면 DASHBOARD의 "작업 대기공간"(시간 배정 전)으로 올라간다.
 */
export function ProductionOrdersTab({ completed = false }: { completed?: boolean } = {}) {
  const queryClient = useQueryClient();
  const orders = useQuery(ordersQuery());
  const sessions = useQuery(workSessionsQuery());
  const components = useQuery(dashboardComponentsQuery());
  const [adding, setAdding] = useState<{ orderId: string; slot: CoreSlot } | null>(null);
  const dietaryOf = useOrderDietaryNames();
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"pick" | "copy" | "new">("pick");
  const [orderTypeTab, setOrderTypeTab] = useState<"CAKE" | "POPUP">("CAKE");

  const list = useMemo(
    () =>
      buildProductionOrderCards(
        orders.data ?? [],
        components.data ?? [],
        sessions.data ?? [],
        completed,
      ),
    [orders.data, components.data, sessions.data, completed],
  );

  const refresh = async (sessionId?: string) => {
    if (sessionId) {
      await queryClient.invalidateQueries({
        queryKey: ["work_session_formula_versions", sessionId],
      });
      await queryClient.invalidateQueries({ queryKey: ["work_session_tasks", sessionId] });
    }
    await queryClient.invalidateQueries({ queryKey: ["work_sessions"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard_components"] });
    await queryClient.invalidateQueries({ queryKey: ["work_blocks"] });
  };

  // 2026-11-09 사용자 요청: 오더 카드에서 바로 STATUS를 바꿔 직접 COMPLETED 처리할 수 있게 한다.
  // COMPLETED로 바꾸면 이 탭(진행 중)에서 빠지고 ORDER HISTORY로 넘어간다.
  const setOrderStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const previous = (orders.data ?? []).find((o) => o.id === id)?.status;
      if (previous === "COMPLETED" && status !== "COMPLETED") {
        const msg = await syncOrderDeliveryToPlanner(id, false);
        if (msg) toast.error(`플래너 Delivery 체크 해제 실패 — ${msg}`);
      }
      const { error } = await supabase.from("orders").update({ status }).eq("id", id);
      if (error) throw error;
      // COMPLETED → 플래너의 Delivery TASK도 완료 체크(2026-11-09). 실패해도 상태 변경은 유지하고 알림만.
      if (status === "COMPLETED" && previous !== "COMPLETED") {
        const msg = await syncOrderDeliveryToPlanner(id, true);
        if (msg) toast.error(`플래너 Delivery 완료 체크 실패 — ${msg}`);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
      await invalidateProductionSync(queryClient);
    },
    onError: (e) => toast.error(`상태 변경 실패 — ${(e as Error).message}`),
  });

  const createSession = useMutation({
    mutationFn: async (order: NonNullable<typeof orders.data>[number]) => {
      await ensureWorkSessionForOrder(order.id);
    },
    onSuccess: async (_, order) => {
      setSessionErrors((all) => {
        const next = { ...all };
        delete next[order.id];
        return next;
      });
      await refresh();
    },
    onError: (error, order) =>
      setSessionErrors((all) => ({ ...all, [order.id]: (error as Error).message })),
  });

  // 모든 진행 중 오더는 WORK SESSION을 기본으로 가진다 — 없는 오더가 보이면 자동으로 채운다.
  const ensuredRef = useRef(new Set<string>());
  useEffect(() => {
    if (completed || orders.isError || sessions.isError || !orders.data || !sessions.data) return;
    const missing = orders.data.filter(
      (o) =>
        o.order_kind !== "POPUP" &&
        o.status !== "COMPLETED" &&
        o.status !== "CANCELLED" &&
        !ensuredRef.current.has(o.id) &&
        !sessions.data.some((s) => s.order_id === o.id),
    );
    if (missing.length === 0) return;
    for (const o of missing) ensuredRef.current.add(o.id);
    void (async () => {
      let prepared = false;
      for (const o of missing) {
        try {
          await ensureWorkSessionForOrder(o.id);
          prepared = true;
        } catch (error) {
          setSessionErrors((all) => ({ ...all, [o.id]: (error as Error).message }));
        }
      }
      if (prepared) await queryClient.invalidateQueries({ queryKey: ["work_sessions"] });
    })();
  }, [orders.data, orders.isError, sessions.data, sessions.isError, queryClient, completed]);

  if (orders.isLoading) {
    return <p className="font-mono text-xs uppercase text-muted-foreground">LOADING…</p>;
  }
  if (orders.isError)
    return (
      <div role="alert" className="space-y-2 text-sm text-destructive">
        주문 목록을 불러오지 못했습니다.{" "}
        <button type="button" className={buttonClass} onClick={() => void orders.refetch()}>
          다시 불러오기
        </button>
      </div>
    );
  const visibleOrders = list.filter(
    ({ order }) => (orderTypeTab === "POPUP") === (order.order_kind === "POPUP"),
  );

  return (
    <div className="w-full max-w-[64rem] space-y-3">
      {(sessions.isError || components.isError) && (
        <p role="alert" className="text-xs text-destructive">
          주문 카드는 표시했지만 일부 생산 정보를 불러오지 못했습니다.{" "}
          <button type="button" className="underline" onClick={() => void refresh()}>
            생산 정보 재시도
          </button>
        </p>
      )}
      {createSession.isError && (
        <p className="font-mono text-xs text-destructive">
          {(createSession.error as Error).message}
        </p>
      )}
      <div
        className="flex flex-wrap gap-1 border-b border-border pb-2"
        role="tablist"
        aria-label="오더 종류"
      >
        {(["CAKE", "POPUP"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={orderTypeTab === tab}
            className={cn(
              buttonClass,
              "px-3 py-1 text-xs",
              orderTypeTab === tab && "bg-secondary font-semibold",
            )}
            onClick={() => setOrderTypeTab(tab)}
          >
            {tab === "CAKE" ? "CAKE ORDERS" : "POP-UP ORDERS"}
            <span className="ml-1 opacity-60">
              {
                list.filter(({ order }) => (tab === "POPUP") === (order.order_kind === "POPUP"))
                  .length
              }
            </span>
          </button>
        ))}
      </div>
      {visibleOrders.length === 0 && (
        <p className="text-xs text-muted-foreground">이 유형의 오더가 없어요.</p>
      )}
      <div className="grid grid-cols-1 gap-3">
        {visibleOrders.map(({ order, rows, session, ambiguousSession }) =>
          order.order_kind === "POPUP" ? (
            <PopupProductionCard key={order.id} order={order} />
          ) : (
            <section key={order.id} className="space-y-2 border border-border bg-card p-3">
              <ProductionOrderHeader
                number={order.order_number}
                title={
                  <>
                    <Link
                      to="/orders/$orderId"
                      params={{ orderId: order.id }}
                      className="text-sm underline-offset-2 hover:underline"
                    >
                      {order.customers?.name || order.recipient || "주문 상세"}
                    </Link>
                    <OrderFlagBoxes
                      dietary={dietaryOf(order.id)}
                      leastLiked={order.least_liked_flavours}
                    />
                  </>
                }
                meta={formatDelivery(order.pickup_at, order.event_date)}
                status={
                  <select
                    className={productionOrderStatusClass}
                    value={order.status}
                    disabled={setOrderStatus.isPending}
                    onChange={(e) =>
                      setOrderStatus.mutate({ id: order.id, status: e.target.value })
                    }
                    aria-label="오더 상태"
                  >
                    {ORDER_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {orderStatusLabel(st)}
                      </option>
                    ))}
                  </select>
                }
              />
              {ambiguousSession && (
                <p role="alert" className="text-xs text-destructive">
                  연결된 Work Session이 여러 개입니다. 임의로 선택하지 않았어요. 세션 연결을 먼저
                  확인하세요.
                </p>
              )}
              {!session && !ambiguousSession && !completed && order.status !== "CANCELLED" && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={
                      sessionErrors[order.id] ? "text-destructive" : "text-muted-foreground"
                    }
                  >
                    {sessionErrors[order.id]
                      ? `생산 준비 실패: ${sessionErrors[order.id]}`
                      : sessions.isLoading
                        ? "생산 정보를 불러오는 중…"
                        : "생산 준비 중 · 주문은 목록에 유지됩니다."}
                  </span>
                  {!sessions.isLoading && (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={createSession.isPending}
                      onClick={() => createSession.mutate(order)}
                    >
                      생산 준비 재시도
                    </button>
                  )}
                </div>
              )}
              <ProductionOrderComponentList
                sessionId={session?.id ?? ""}
                dashboardRows={rows}
                readOnly={completed || order.status === "CANCELLED" || ambiguousSession}
                title={
                  <p className="text-sm font-medium">{order.products?.name || "제품 미지정"}</p>
                }
                details={
                  <ProductionOrderSizeEditor
                    order={order}
                    sessionId={session?.id ?? ""}
                    readOnly={completed || order.status === "CANCELLED" || ambiguousSession}
                  />
                }
              />

              {/* 슬롯 버튼은 세션 유무와 상관없이 항상 — 세션이 없으면 누르는 순간 자동으로 만든다 */}
              <div
                className={cn(
                  "space-y-1.5",
                  (completed || order.status === "CANCELLED") && "hidden",
                )}
              >
                <div className="flex flex-wrap gap-1">
                  {CORE_SLOTS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={cn(
                        buttonClass,
                        "!min-h-[26px] px-1.5 text-[11px]",
                        adding?.orderId === order.id && adding.slot === slot && "bg-secondary",
                      )}
                      disabled={
                        createSession.isPending ||
                        ambiguousSession ||
                        sessions.isError ||
                        sessions.isLoading
                      }
                      onClick={async () => {
                        if (adding?.orderId === order.id && adding.slot === slot) {
                          setAdding(null);
                          return;
                        }
                        if (!session) {
                          try {
                            await createSession.mutateAsync(order);
                          } catch {
                            return;
                          }
                        }
                        setAdding({ orderId: order.id, slot });
                      }}
                    >
                      + {CORE_SLOT_LABELS[slot].toUpperCase()}
                    </button>
                  ))}
                </div>
                {adding?.orderId === order.id && (
                  <div className="flex gap-1">
                    {(["pick", "copy", "new"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={cn(
                          buttonClass,
                          "!min-h-[24px] px-1.5 text-[10px]",
                          mode === m && "bg-secondary",
                        )}
                        onClick={() => setMode(m)}
                      >
                        {m === "pick"
                          ? "기존 컴포넌트 지정"
                          : m === "copy"
                            ? "복사해서 새로 만들기"
                            : "빈 컴포넌트 새로 만들기"}
                      </button>
                    ))}
                  </div>
                )}
                {session && adding?.orderId === order.id && mode === "new" && (
                  <DashboardComponentNewForm
                    key={`new-${adding.slot}`}
                    sessionId={session.id}
                    slot={adding.slot}
                    nextSort={rows.length}
                    onDone={async () => {
                      setAdding(null);
                      await refresh(session.id);
                    }}
                  />
                )}
                {session && adding?.orderId === order.id && mode === "copy" && (
                  <DashboardComponentCopyForm
                    key={`copy-${adding.slot}`}
                    sessionId={session.id}
                    slot={adding.slot}
                    nextSort={rows.length}
                    onDone={async () => {
                      setAdding(null);
                      await refresh(session.id);
                    }}
                  />
                )}
                {session && adding?.orderId === order.id && mode === "pick" && (
                  <AddFormulaVersionForm
                    addOnSelect
                    cakeSizeId={session.cake_size_id ?? order.cake_size_id}
                    key={adding.slot}
                    sessionId={session.id}
                    nextSort={rows.length}
                    slot={adding.slot}
                    productId={session.product_id}
                    productSizeId={session.product_size_id}
                    onDone={async () => {
                      setAdding(null);
                      await refresh(session.id);
                    }}
                  />
                )}
              </div>
            </section>
          ),
        )}
      </div>
    </div>
  );
}

function ProductionOrderComponentList({
  sessionId,
  dashboardRows,
  readOnly,
  title,
  details,
}: {
  sessionId: string;
  dashboardRows: DashboardComponentRow[];
  readOnly: boolean;
  title: React.ReactNode;
  details: React.ReactNode;
}) {
  const selections = useQuery(workSessionFormulaVersionsQuery(sessionId));
  return (
    <>
      {sessionId && selections.isError && (
        <p role="alert" className="text-xs text-destructive">
          컴포넌트를 불러오지 못했습니다.{" "}
          <button type="button" className="underline" onClick={() => void selections.refetch()}>
            재시도
          </button>
        </p>
      )}
      <ProductionComponentTable
        sessionId={sessionId}
        rows={selections.data ?? []}
        readOnly={readOnly}
        title={title}
        details={details}
        allowFormulaChange
        warning={(id) => {
          const row = dashboardRows.find((entry) => entry.id === id);
          return row?.unmodifiedCopy ? <CopyWarning formulaId={row.formulaId} /> : null;
        }}
      />
    </>
  );
}
