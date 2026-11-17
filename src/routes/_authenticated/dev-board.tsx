import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, buttonClass, inputClass, primaryButtonClass } from "@/components/pilot/ui";
import { cn } from "@/lib/utils";
import {
  DEV_OS,
  DEV_STATUSES,
  DEV_STATUS_LABEL,
  filterItems,
  nextWorkKey,
  type DevOs,
  type DevRelationKind,
  type DevStatus,
} from "@/lib/dev-board";
import {
  DEV_BOARD_KEY,
  addRef,
  addRelation,
  createWorkItem,
  deleteWorkItem,
  devBoardQuery,
  isMissingTable,
  removeRef,
  removeRelation,
  syncGithub,
  updateWorkItem,
} from "@/lib/dev-board-queries";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { DevBoardTable } from "@/components/pilot/dev-board/DevBoardTable";
import { DevBoardKanban } from "@/components/pilot/dev-board/DevBoardKanban";
import { DevBoardGraph } from "@/components/pilot/dev-board/DevBoardGraph";
import { DevWorkDrawer } from "@/components/pilot/dev-board/DevWorkDrawer";

type View = "TABLE" | "KANBAN" | "GRAPH";

// YEON OS Development Board (pastry-pilot#17). Deep link: /dev-board?view=GRAPH&item=YOS-001
export const Route = createFileRoute("/_authenticated/dev-board")({
  head: () => ({
    meta: [
      { title: "PILOT — YEON OS Development Board" },
      { name: "description", content: "Software change tracking across SHCS, PILOT and Planner" },
    ],
  }),
  validateSearch: (
    s: Record<string, unknown>,
  ): { view?: View | undefined; item?: string | undefined } => ({
    view:
      s["view"] === "TABLE" || s["view"] === "KANBAN" || s["view"] === "GRAPH"
        ? s["view"]
        : undefined,
    item: typeof s["item"] === "string" ? s["item"] : undefined,
  }),
  component: DevBoardPage,
});

function DevBoardPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const board = useQuery(devBoardQuery());
  const view: View = search.view ?? "TABLE";
  const [q, setQ] = useState("");
  const [os, setOs] = useState<DevOs[]>([]);
  const [statuses, setStatuses] = useState<DevStatus[]>([]);
  const [showRefs, setShowRefs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const items = board.data?.items ?? [];
  const refs = board.data?.refs ?? [];
  const relations = board.data?.relations ?? [];
  const visible = filterItems(items, { q, os, statuses });
  const selected = search.item
    ? (items.find((i) => i.work_key === search.item || i.id === search.item) ?? null)
    : null;

  const setSearch = (patch: { view?: View; item?: string | undefined }) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const open = (id: string) => setSearch({ item: items.find((i) => i.id === id)?.work_key ?? id });
  const refresh = () => qc.invalidateQueries({ queryKey: DEV_BOARD_KEY });
  const fail = (e: unknown) => setError((e as Error).message);

  const save = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TablesUpdate<"dev_work_items"> }) =>
      updateWorkItem(id, patch),
    onSuccess: refresh,
    onError: fail,
  });
  const create = useMutation({
    mutationFn: async () => {
      const key = nextWorkKey(items.map((i) => i.work_key));
      await createWorkItem(key, "New work item");
      return key;
    },
    onSuccess: async (key) => {
      await refresh();
      setSearch({ item: key });
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: deleteWorkItem,
    onSuccess: async () => {
      setSearch({ item: undefined });
      await refresh();
    },
    onError: fail,
  });
  const link = useMutation({
    mutationFn: ({ from, to, kind }: { from: string; to: string; kind: DevRelationKind }) =>
      addRelation(from, to, kind),
    onSuccess: refresh,
    onError: fail,
  });
  const sync = useMutation({
    mutationFn: syncGithub,
    onSuccess: async (r) => {
      if (r.status === "ok") {
        setSyncNote(
          `GitHub synced ${r.synced} link(s)` +
            (r.failed.length ? `, ${r.failed.length} failed` : "") +
            (r.authenticated ? "." : " (public repos only; no read token set)."),
        );
        await refresh();
      } else {
        setSyncNote(
          r.reason === "function_unreachable"
            ? "GitHub sync is not deployed yet. Links still open GitHub; states are not cached."
            : `GitHub sync unavailable (${r.reason}).`,
        );
      }
    },
    onError: fail,
  });

  if (board.error && isMissingTable(board.error)) {
    return (
      <div className="space-y-3">
        <PageHeader title="YEON OS / DEVELOPMENT BOARD" />
        <p className="max-w-xl font-mono text-xs text-muted-foreground">
          The Development Board tables are not in the database yet. Run
          supabase/migrations/20261117010000_yeon_os_dev_board.sql in the Supabase SQL editor, then
          reload.
        </p>
      </div>
    );
  }

  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <div className="space-y-2">
      <PageHeader
        title="YEON OS / DEVELOPMENT BOARD"
        action={
          <div className="flex gap-1">
            <button
              type="button"
              className={buttonClass}
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? "Syncing…" : "Sync GitHub"}
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              + New item
            </button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-1">
        {(["TABLE", "KANBAN", "GRAPH"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setSearch({ view: v })}
            className={cn(
              "border px-3 py-1 font-mono text-xs uppercase",
              view === v ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {v}
          </button>
        ))}
        <input
          className={cn(inputClass, "ml-2 w-[200px]")}
          placeholder="Search ID, goal, blocker"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="ml-2 label-caps text-[10px] text-muted-foreground">OS</span>
        {DEV_OS.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={os.includes(o)}
            onClick={() => setOs((l) => toggle(l, o))}
            className={cn(
              "border px-1.5 py-0.5 font-mono text-[11px]",
              os.includes(o) ? "border-foreground bg-foreground text-background" : "border-border",
            )}
          >
            {o}
          </button>
        ))}
        {view === "GRAPH" && (
          <label className="ml-2 flex items-center gap-1 font-mono text-[11px]">
            <input
              type="checkbox"
              checked={showRefs}
              onChange={(e) => setShowRefs(e.target.checked)}
            />
            show issues/PRs
          </label>
        )}
      </div>
      {view !== "KANBAN" && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="label-caps text-[10px] text-muted-foreground">Status</span>
          {DEV_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={statuses.includes(s)}
              onClick={() => setStatuses((l) => toggle(l, s))}
              className={cn(
                "border px-1.5 py-0.5 font-mono text-[11px]",
                statuses.includes(s)
                  ? "border-foreground bg-foreground text-background"
                  : "border-border",
              )}
            >
              {DEV_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="font-mono text-xs text-destructive">
          {error}{" "}
          <button type="button" className="underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </p>
      )}
      {syncNote && <p className="font-mono text-[11px] text-muted-foreground">{syncNote}</p>}
      {board.isLoading && <p className="font-mono text-xs text-muted-foreground">Loading…</p>}
      {board.error && !isMissingTable(board.error) && (
        <p className="font-mono text-xs text-destructive">{(board.error as Error).message}</p>
      )}

      {view === "TABLE" && (
        <DevBoardTable
          items={visible}
          refs={refs}
          onOpen={open}
          onPatch={(id, patch) => save.mutate({ id, patch })}
        />
      )}
      {view === "KANBAN" && (
        <DevBoardKanban
          items={visible}
          refs={refs}
          onOpen={open}
          onMove={(id, status) => save.mutate({ id, patch: { status } })}
        />
      )}
      {view === "GRAPH" && (
        <DevBoardGraph
          items={visible}
          refs={refs}
          relations={relations}
          showRefs={showRefs}
          onOpen={open}
          onConnect={(from, to) => link.mutate({ from, to, kind: "RELATED" })}
        />
      )}

      <DevWorkDrawer
        item={selected}
        items={items}
        refs={refs}
        relations={relations}
        onClose={() => setSearch({ item: undefined })}
        onSave={(id, patch) => save.mutate({ id, patch })}
        onDelete={(id) => remove.mutate(id)}
        onAddRef={async (id, input) => {
          await addRef(id, input);
          await refresh();
        }}
        onRemoveRef={(id) => removeRef(id).then(refresh, fail)}
        onAddRelation={(from, to, kind) => link.mutate({ from, to, kind })}
        onRemoveRelation={(id) => removeRelation(id).then(refresh, fail)}
      />
    </div>
  );
}
