import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type ShoppingItem = {
  id: string;
  title: string;
  due_date: string | null;
  completed: boolean;
  recurrence: string;
  shopping_order: number;
  shopping_type: string | null;
  created_at: string;
};
type ShoppingData = {
  items: ShoppingItem[];
  completions: { task_id: string; occurrence_date: string }[];
};
const KEY = ["planner-shopping"] as const;
async function request(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("planner-shopping", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** Shared Planner list: no PILOT shopping table or local-only shadow copies. */
export function PlannerShoppingPanel({ date }: { date: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [addDate, setAddDate] = useState(date);
  const [message, setMessage] = useState<string | null>(null);
  const query = useQuery<ShoppingData>({
    queryKey: KEY,
    queryFn: () => request({ action: "list" }),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });
  const add = useMutation({
    mutationFn: (title: string) => request({ action: "add", title, date: addDate }),
    onSuccess: async () => {
      setDraft("");
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setMessage((e as Error).message),
  });
  const toggle = useMutation({
    mutationFn: ({ id, date, completed }: { id: string; date: string; completed: boolean }) =>
      request({ action: "toggle", id, date, completed }),
    onSuccess: async () => {
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setMessage((e as Error).message),
  });
  const today = localToday();
  const items = (query.data?.items ?? []).filter((item) => {
    if (showAll) return true;
    // Show all outstanding items, including overdue and future purchases.
    // Recurring entries are displayed as today's occurrence; Planner owns the recurrence rule.
    return item.recurrence !== "none" || !item.completed;
  });
  const doneFor = (item: ShoppingItem, occurrence: string) =>
    item.recurrence === "none"
      ? item.completed
      : (query.data?.completions ?? []).some((c) => c.task_id === item.id && c.occurrence_date === occurrence);
  return (
    <section className="border border-border bg-card p-3 space-y-2" aria-label="Planner Shopping List">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="label-caps text-xs">Shopping List · Planner</h2>
          <span className="text-[10px] text-muted-foreground">양방향 동기화 · 15초 자동 새로고침</span>
        </div>
        <div className="flex gap-2 items-center">
          <button type="button" className="text-xs underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "미완료만" : "전체 리스트"}
          </button>
          <button type="button" className="text-xs underline" disabled={query.isFetching} onClick={() => void query.refetch()}>
            새로고침
          </button>
        </div>
      </div>
      <form className="flex flex-wrap gap-2 items-center" onSubmit={(e) => {
        e.preventDefault();
        const title = draft.trim();
        if (title && !add.isPending) add.mutate(title);
      }}>
        <input className="min-w-[160px] flex-1 border-b border-border bg-transparent p-1 text-sm outline-none"
          aria-label="Shopping quick add" placeholder="구매할 항목 빠른 추가"
          value={draft} onChange={(e) => setDraft(e.target.value)} />
        <input type="date" aria-label="Shopping date" className="border border-border bg-background p-1 text-xs"
          value={addDate} onChange={(e) => setAddDate(e.target.value)} />
        <button type="submit" className="border border-border px-3 py-1 text-xs" disabled={!draft.trim() || add.isPending}>
          {add.isPending ? "추가 중…" : "+ 추가"}
        </button>
      </form>
      {query.isLoading && <p className="text-xs text-muted-foreground">Planner 쇼핑 리스트 불러오는 중…</p>}
      {(query.isError || message) && <p role="alert" className="text-xs text-destructive">
        Planner 연결 오류: {message ?? (query.error as Error)?.message}
      </p>}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <p className="text-xs text-muted-foreground">표시할 쇼핑 항목이 없어요.</p>
      )}
      <div className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const occurrence = item.recurrence === "none" ? item.due_date ?? today : today;
          const done = doneFor(item, occurrence);
          return <div key={item.id} className="flex items-center gap-2 min-w-0 text-xs py-1 border-b border-border/40">
            <input type="checkbox" aria-label={`${item.title} 완료`} checked={done}
              disabled={toggle.isPending}
              onChange={(e) => toggle.mutate({ id: item.id, date: occurrence, completed: e.target.checked })} />
            <span className={`flex-1 min-w-0 truncate ${done ? "line-through text-muted-foreground" : ""}`} title={item.title}>
              {item.title}
            </span>
            {item.shopping_type && <span className="text-[10px] text-muted-foreground">{item.shopping_type.replaceAll("_", " ")}</span>}
            {item.due_date && <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{item.due_date.slice(5)}</span>}
          </div>;
        })}
      </div>
    </section>
  );
}
