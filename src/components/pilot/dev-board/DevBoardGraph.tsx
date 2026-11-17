import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  DEV_RELATION_LABEL,
  graphLayout,
  shortRef,
  githubStateLabel,
  type DevRelationKind,
} from "@/lib/dev-board";
import type { DevWorkItem, DevWorkRef, DevWorkRelation } from "@/lib/dev-board-queries";
import { OsBadge, StatusBadge } from "./badges";

type WorkData = { item: DevWorkItem };
type RefData = { r: DevWorkRef };

function WorkNode({ data, selected }: NodeProps<Node<WorkData>>) {
  const i = data.item;
  return (
    <div
      className={
        "w-[210px] border bg-card p-1.5 text-[12px] shadow-sm " +
        (selected ? "border-foreground" : "border-border")
      }
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[10px] text-muted-foreground">{i.work_key}</span>
        <StatusBadge status={i.status} />
      </div>
      <div className="line-clamp-2 font-medium leading-tight">{i.title}</div>
      <div className="mt-1 flex flex-wrap gap-0.5">
        <OsBadge os={i.owning_os} />
        {i.affected_os
          .filter((o) => o !== i.owning_os)
          .map((o) => (
            <OsBadge key={o} os={o} />
          ))}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function RefNode({ data }: NodeProps<Node<RefData>>) {
  const state = githubStateLabel(data.r);
  return (
    <div className="rounded-full border border-dashed border-border bg-background px-2 py-0.5 font-mono text-[10px]">
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      {data.r.kind === "PR" ? "PR " : data.r.kind === "ISSUE" ? "Issue " : ""}
      {shortRef(data.r)}
      {state ? ` · ${state}` : ""}
    </div>
  );
}

const nodeTypes = { work: WorkNode, ref: RefNode };

/**
 * Obsidian-like linked view of the same records. Work nodes sit in one column per owning OS;
 * GitHub refs hang off their item as small nodes (click opens GitHub). Drag from a node's right
 * handle to another node to add a "related" link; edit link kinds in the detail drawer.
 * Positions are computed (not saved), so every viewer sees the same layout.
 */
function Graph({
  items,
  refs,
  relations,
  showRefs,
  onOpen,
  onConnect,
}: {
  items: DevWorkItem[];
  refs: DevWorkRef[];
  relations: DevWorkRelation[];
  showRefs: boolean;
  onOpen: (id: string) => void;
  onConnect: (fromId: string, toId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const pos = graphLayout(items);
    const ids = new Set(items.map((i) => i.id));
    const nodes: Node[] = items.map((i) => ({
      id: i.id,
      type: "work",
      position: pos[i.id] ?? { x: 0, y: 0 },
      data: { item: i },
    }));
    const edges: Edge[] = relations
      .filter((r) => ids.has(r.from_id) && ids.has(r.to_id))
      .map((r) => ({
        id: r.id,
        source: r.from_id,
        target: r.to_id,
        label: DEV_RELATION_LABEL[r.kind as DevRelationKind] ?? r.kind,
        animated: r.kind === "BLOCKS",
        labelStyle: { fontSize: 10, fontFamily: "monospace" },
        ...(r.kind === "RELATED"
          ? { style: { strokeDasharray: "4 3" } }
          : { markerEnd: { type: MarkerType.ArrowClosed } }),
      }));
    if (showRefs) {
      for (const i of items) {
        const mine = refs.filter((r) => r.work_item_id === i.id);
        mine.forEach((r, k) => {
          const base = pos[i.id] ?? { x: 0, y: 0 };
          nodes.push({
            id: `ref:${r.id}`,
            type: "ref",
            position: { x: base.x + 225, y: base.y + k * 24 },
            data: { r },
            draggable: false,
            connectable: false,
          });
          edges.push({
            id: `refedge:${r.id}`,
            source: i.id,
            target: `ref:${r.id}`,
            style: { stroke: "var(--color-border, #ccc)" },
          });
        });
      }
    }
    return { nodes, edges };
  }, [items, refs, relations, showRefs]);

  return (
    <div className="h-[calc(100vh-220px)] min-h-[420px] border border-border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        nodesDraggable={false}
        onNodeClick={(_, n) => {
          if (n.type === "ref") {
            const r = (n.data as RefData).r;
            window.open(r.url, "_blank", "noopener,noreferrer");
          } else onOpen(n.id);
        }}
        onConnect={(c: Connection) => {
          if (c.source && c.target && c.source !== c.target && !c.target.startsWith("ref:"))
            onConnect(c.source, c.target);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function DevBoardGraph(props: Parameters<typeof Graph>[0]) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}
