import { useState } from "react";
import { cn } from "@/lib/utils";
import { DEV_STATUSES, DEV_STATUS_HINT, DEV_STATUS_LABEL, isCrossOs } from "@/lib/dev-board";
import type { DevWorkItem, DevWorkRef } from "@/lib/dev-board-queries";
import { OsBadge, RefLink } from "./badges";

/** Compact Kanban: one column per status. Drag a card to another column to change its status. */
export function DevBoardKanban({
  items,
  refs,
  onOpen,
  onMove,
}: {
  items: DevWorkItem[];
  refs: DevWorkRef[];
  onOpen: (id: string) => void;
  onMove: (id: string, status: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2">
      {DEV_STATUSES.map((s) => {
        const col = items.filter((i) => i.status === s);
        return (
          <div
            key={s}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s);
            }}
            onDragLeave={() => setOver((o) => (o === s ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/dev-work-id");
              if (id) onMove(id, s);
            }}
            className={cn(
              "flex w-[180px] shrink-0 flex-col border border-border bg-muted/30",
              (s === "BLOCKED" || s === "FAILED") && "border-dashed",
              over === s && "border-foreground bg-secondary",
            )}
          >
            <header className="border-b border-border px-1.5 py-1" title={DEV_STATUS_HINT[s]}>
              <span className="label-caps text-[10px]">{DEV_STATUS_LABEL[s]}</span>
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{col.length}</span>
            </header>
            <div className="flex min-h-[80px] flex-col gap-1 p-1">
              {col.map((i) => (
                <div
                  key={i.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/dev-work-id", i.id)}
                  onClick={() => onOpen(i.id)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(i.id)}
                  className="cursor-grab border border-border bg-card p-1.5 text-[12px] hover:border-foreground"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {i.work_key}
                    </span>
                    <span className="font-mono text-[10px]">{i.priority}</span>
                  </div>
                  <div className="line-clamp-2 font-medium leading-tight">{i.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-0.5">
                    <OsBadge os={i.owning_os} />
                    {isCrossOs(i) && (
                      <span className="font-mono text-[9px] text-muted-foreground">+cross</span>
                    )}
                  </div>
                  {i.blocker && (
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-destructive">
                      {i.blocker}
                    </div>
                  )}
                  <div className="mt-0.5 flex flex-wrap gap-x-1.5">
                    {refs
                      .filter(
                        (r) => r.work_item_id === i.id && (r.kind === "ISSUE" || r.kind === "PR"),
                      )
                      .map((r) => (
                        <RefLink key={r.id} r={r} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
