import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { buttonClass, inputClass, primaryButtonClass } from "@/components/pilot/ui";
import { cn } from "@/lib/utils";
import {
  DEV_OS,
  DEV_PRIORITIES,
  DEV_RELATION_KINDS,
  DEV_RELATION_LABEL,
  DEV_STATUSES,
  DEV_STATUS_HINT,
  DEV_STATUS_LABEL,
  suggestedStatus,
  type DevRelationKind,
  type DevStatus,
} from "@/lib/dev-board";
import {
  devWorkEventsQuery,
  type DevWorkItem,
  type DevWorkRef,
  type DevWorkRelation,
} from "@/lib/dev-board-queries";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { RefLink, StatusBadge } from "./badges";

type Patch = TablesUpdate<"dev_work_items">;
type TextKey =
  | "title"
  | "goal"
  | "expected_outcome"
  | "actual_result"
  | "rationale"
  | "scope"
  | "acceptance_criteria"
  | "implementation_notes"
  | "tests"
  | "deployment"
  | "runtime_verification"
  | "verification_evidence"
  | "blocker";

/** Text field that saves on blur (same autosave feel as the order editor). */
function AutoText({
  item,
  field,
  label,
  rows = 2,
  hint,
  onSave,
}: {
  item: DevWorkItem;
  field: TextKey;
  label: string;
  rows?: number;
  hint?: string;
  onSave: (p: Patch) => void;
}) {
  const value = (item[field] as string | null) ?? "";
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [item.id, value]);
  const commit = () => {
    const next = draft.trim();
    if (next === value.trim()) return;
    if (field === "title" && !next) return setDraft(value);
    onSave({ [field]: next || null } as Patch);
  };
  return (
    <label className="block">
      <span className="label-caps text-[10px] text-muted-foreground">{label}</span>
      {rows === 1 ? (
        <input
          className={inputClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <textarea
          className={cn(inputClass, "resize-y py-1")}
          rows={rows}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      )}
      {hint && <span className="font-mono text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function DevWorkDrawer({
  item,
  items,
  refs,
  relations,
  onClose,
  onSave,
  onDelete,
  onAddRef,
  onRemoveRef,
  onAddRelation,
  onRemoveRelation,
}: {
  item: DevWorkItem | null;
  items: DevWorkItem[];
  refs: DevWorkRef[];
  relations: DevWorkRelation[];
  onClose: () => void;
  onSave: (id: string, p: Patch) => void;
  onDelete: (id: string) => void;
  onAddRef: (id: string, input: string) => Promise<void>;
  onRemoveRef: (refId: string) => void;
  onAddRelation: (fromId: string, toId: string, kind: DevRelationKind) => void;
  onRemoveRelation: (relId: string) => void;
}) {
  const [refInput, setRefInput] = useState("");
  const [refError, setRefError] = useState<string | null>(null);
  const [relKind, setRelKind] = useState<DevRelationKind>("DEPENDS_ON");
  const [relTarget, setRelTarget] = useState("");
  const events = useQuery({ ...devWorkEventsQuery(item?.id ?? ""), enabled: Boolean(item) });

  if (!item) return null;
  const save = (p: Patch) => onSave(item.id, p);
  const myRefs = refs.filter((r) => r.work_item_id === item.id);
  const myRels = relations.filter((r) => r.from_id === item.id || r.to_id === item.id);
  const nameOf = (id: string) => {
    const i = items.find((x) => x.id === id);
    return i ? `${i.work_key} ${i.title}` : "(missing)";
  };
  const suggestion = suggestedStatus(item.status as DevStatus, myRefs);
  const hint = DEV_STATUS_HINT[item.status as DevStatus];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-3 sm:max-w-[560px]">
        <SheetHeader className="space-y-1 p-0 pb-2">
          <SheetTitle className="flex items-center gap-2 font-mono text-sm">
            {item.work_key} <StatusBadge status={item.status} />
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            GitHub is the source of truth for issues, PRs and code. This record links to it.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-2">
          <AutoText item={item} field="title" label="Title" rows={1} onSave={save} />
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="label-caps text-[10px] text-muted-foreground">Status</span>
              <select
                className={inputClass}
                value={item.status}
                onChange={(e) => save({ status: e.target.value })}
              >
                {DEV_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DEV_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label-caps text-[10px] text-muted-foreground">Priority</span>
              <select
                className={inputClass}
                value={item.priority}
                onChange={(e) => save({ priority: e.target.value })}
              >
                {DEV_PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label-caps text-[10px] text-muted-foreground">Owning OS</span>
              <select
                className={inputClass}
                value={item.owning_os}
                onChange={(e) => save({ owning_os: e.target.value })}
              >
                {DEV_OS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>
          {hint && <p className="font-mono text-[10px] text-muted-foreground">{hint}</p>}
          {suggestion && (
            <p className="flex items-center gap-2 border border-dashed border-border px-2 py-1 text-[11px]">
              GitHub suggests <b>{DEV_STATUS_LABEL[suggestion]}</b>.
              <button
                type="button"
                className={buttonClass}
                onClick={() => save({ status: suggestion })}
              >
                Apply
              </button>
            </p>
          )}
          <fieldset>
            <legend className="label-caps text-[10px] text-muted-foreground">Affected OSes</legend>
            <div className="flex flex-wrap gap-1">
              {DEV_OS.map((o) => {
                const on = item.affected_os.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      save({
                        affected_os: on
                          ? item.affected_os.filter((x) => x !== o)
                          : [...item.affected_os, o],
                      })
                    }
                    className={cn(
                      "border px-2 py-0.5 font-mono text-[11px]",
                      on ? "border-foreground bg-foreground text-background" : "border-border",
                    )}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <AutoText item={item} field="goal" label="Goal / problem" onSave={save} />
          <AutoText item={item} field="rationale" label="Rationale" onSave={save} />
          <AutoText item={item} field="scope" label="Scope" onSave={save} />
          <AutoText
            item={item}
            field="acceptance_criteria"
            label="Acceptance criteria"
            rows={3}
            onSave={save}
          />
          <AutoText item={item} field="expected_outcome" label="Expected outcome" onSave={save} />
          <AutoText item={item} field="actual_result" label="Actual result" onSave={save} />
          <AutoText
            item={item}
            field="implementation_notes"
            label="Implementation notes"
            rows={3}
            onSave={save}
          />
          <AutoText
            item={item}
            field="tests"
            label="Tests (actually run, with results)"
            onSave={save}
          />
          <AutoText
            item={item}
            field="deployment"
            label="Deployment"
            onSave={save}
            hint="Merged is not deployed."
          />
          <AutoText
            item={item}
            field="runtime_verification"
            label="Runtime verification"
            onSave={save}
            hint="Deployed is not verified."
          />
          <AutoText
            item={item}
            field="verification_evidence"
            label="Verification evidence"
            rows={3}
            onSave={save}
          />
          <AutoText item={item} field="blocker" label="Blocker" onSave={save} />

          <section className="space-y-1 border-t border-border pt-2">
            <h3 className="label-caps text-[10px] text-muted-foreground">
              Links (issues, PRs, docs)
            </h3>
            <ul className="space-y-0.5">
              {myRefs.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <RefLink r={r} />
                    {r.title && (
                      <span className="ml-1 text-[11px] text-muted-foreground">{r.title}</span>
                    )}
                    {r.sync_error && (
                      <span className="ml-1 font-mono text-[10px] text-destructive">
                        sync: {r.sync_error}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="font-mono text-[10px] text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveRef(r.id)}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-1"
              onSubmit={async (e) => {
                e.preventDefault();
                setRefError(null);
                try {
                  await onAddRef(item.id, refInput);
                  setRefInput("");
                } catch (err) {
                  setRefError((err as Error).message);
                }
              }}
            >
              <input
                className={inputClass}
                placeholder="https://github.com/QURIQURA/pastry-pilot/pull/19 or #17"
                value={refInput}
                onChange={(e) => setRefInput(e.target.value)}
              />
              <button type="submit" className={primaryButtonClass} disabled={!refInput.trim()}>
                Add
              </button>
            </form>
            {refError && <p className="font-mono text-[10px] text-destructive">{refError}</p>}
          </section>

          <section className="space-y-1 border-t border-border pt-2">
            <h3 className="label-caps text-[10px] text-muted-foreground">Relationships</h3>
            <ul className="space-y-0.5 text-[12px]">
              {myRels.map((r) => {
                const outgoing = r.from_id === item.id;
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span>
                      {outgoing ? "This " : `${nameOf(r.from_id)} `}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {DEV_RELATION_LABEL[r.kind as DevRelationKind] ?? r.kind}
                      </span>{" "}
                      {outgoing ? nameOf(r.to_id) : "this"}
                    </span>
                    <button
                      type="button"
                      className="font-mono text-[10px] text-muted-foreground hover:text-destructive"
                      onClick={() => onRemoveRelation(r.id)}
                    >
                      remove
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-1">
              <select
                className={cn(inputClass, "w-[120px]")}
                value={relKind}
                onChange={(e) => setRelKind(e.target.value as DevRelationKind)}
              >
                {DEV_RELATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DEV_RELATION_LABEL[k]}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={relTarget}
                onChange={(e) => setRelTarget(e.target.value)}
              >
                <option value="">Choose item…</option>
                {items
                  .filter((i) => i.id !== item.id)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.work_key} {i.title}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className={primaryButtonClass}
                disabled={!relTarget}
                onClick={() => {
                  onAddRelation(item.id, relTarget, relKind);
                  setRelTarget("");
                }}
              >
                Link
              </button>
            </div>
          </section>

          <section className="space-y-1 border-t border-border pt-2">
            <h3 className="label-caps text-[10px] text-muted-foreground">Changelog</h3>
            <ul className="space-y-0.5 font-mono text-[11px]">
              {(events.data ?? []).map((e) => (
                <li key={e.id}>
                  {new Date(e.created_at).toLocaleString("en-AU", {
                    timeZone: "Australia/Sydney",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  ·{" "}
                  {e.from_status
                    ? `${DEV_STATUS_LABEL[e.from_status as DevStatus] ?? e.from_status} → `
                    : "created as "}
                  {DEV_STATUS_LABEL[e.to_status as DevStatus] ?? e.to_status}
                </li>
              ))}
              <li className="text-muted-foreground">
                Created{" "}
                {new Date(item.created_at).toLocaleString("en-AU", {
                  timeZone: "Australia/Sydney",
                  dateStyle: "medium",
                })}
              </li>
            </ul>
          </section>

          <div className="flex justify-end border-t border-border pt-2">
            <button
              type="button"
              className={cn(buttonClass, "text-destructive")}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete ${item.work_key}? Its links and relationships are removed too.`,
                  )
                )
                  onDelete(item.id);
              }}
            >
              Delete item
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
