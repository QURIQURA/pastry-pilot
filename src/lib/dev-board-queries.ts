// YEON OS Development Board (pastry-pilot#17) — Supabase reads/writes. RLS limits all rows to the owner.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import { parseRef, type DevRelationKind } from "@/lib/dev-board";

export type DevWorkItem = Tables<"dev_work_items">;
export type DevWorkRef = Tables<"dev_work_refs">;
export type DevWorkRelation = Tables<"dev_work_relations">;
export type DevWorkEvent = Tables<"dev_work_events">;

export interface DevBoardData {
  items: DevWorkItem[];
  refs: DevWorkRef[];
  relations: DevWorkRelation[];
}

export const DEV_BOARD_KEY = ["dev_board"] as const;

export const devBoardQuery = () =>
  queryOptions({
    queryKey: DEV_BOARD_KEY,
    queryFn: async (): Promise<DevBoardData> => {
      const [items, refs, relations] = await Promise.all([
        supabase.from("dev_work_items").select("*").order("work_key"),
        supabase.from("dev_work_refs").select("*").order("created_at"),
        supabase.from("dev_work_relations").select("*").order("created_at"),
      ]);
      const err = items.error ?? refs.error ?? relations.error;
      if (err) throw err;
      return { items: items.data ?? [], refs: refs.data ?? [], relations: relations.data ?? [] };
    },
  });

export const devWorkEventsQuery = (itemId: string) =>
  queryOptions({
    queryKey: [...DEV_BOARD_KEY, "events", itemId],
    queryFn: async (): Promise<DevWorkEvent[]> => {
      const { data, error } = await supabase
        .from("dev_work_events")
        .select("*")
        .eq("work_item_id", itemId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

/** Postgres "relation does not exist" — the board migration has not been applied yet. */
export function isMissingTable(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return (
    err?.code === "42P01" ||
    err?.code === "PGRST205" ||
    /does not exist|schema cache/i.test(err?.message ?? "")
  );
}

export async function createWorkItem(workKey: string, title: string): Promise<string> {
  const { data, error } = await supabase
    .from("dev_work_items")
    .insert({ work_key: workKey, title })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateWorkItem(id: string, patch: TablesUpdate<"dev_work_items">) {
  const { error } = await supabase.from("dev_work_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteWorkItem(id: string) {
  const { error } = await supabase.from("dev_work_items").delete().eq("id", id);
  if (error) throw error;
}

export async function addRef(itemId: string, input: string) {
  const parsed = parseRef(input);
  if (!parsed) throw new Error("Paste an https link or a ref like owner/repo#12.");
  const { error } = await supabase.from("dev_work_refs").insert({
    work_item_id: itemId,
    kind: parsed.kind,
    repo: parsed.repo,
    number: parsed.number,
    url: parsed.url,
    sync_key: parsed.syncKey,
  });
  if (error) {
    if (error.code === "23505") throw new Error("That link is already on this item.");
    throw error;
  }
}

export async function removeRef(id: string) {
  const { error } = await supabase.from("dev_work_refs").delete().eq("id", id);
  if (error) throw error;
}

export async function addRelation(fromId: string, toId: string, kind: DevRelationKind) {
  if (fromId === toId) throw new Error("An item cannot link to itself.");
  const { error } = await supabase
    .from("dev_work_relations")
    .insert({ from_id: fromId, to_id: toId, kind });
  if (error && error.code !== "23505") throw error;
}

export async function removeRelation(id: string) {
  const { error } = await supabase.from("dev_work_relations").delete().eq("id", id);
  if (error) throw error;
}

export type GithubSyncResult =
  | {
      status: "ok";
      synced: number;
      failed: { id: string; reason: string }[];
      authenticated: boolean;
    }
  | { status: "unavailable"; reason: string };

/** Read-only GitHub snapshot via the `dev-board-github-sync` edge function (no token in the browser). */
export async function syncGithub(): Promise<GithubSyncResult> {
  const { data, error } = await supabase.functions.invoke("dev-board-github-sync", { body: {} });
  if (error) return { status: "unavailable", reason: "function_unreachable" };
  return data as GithubSyncResult;
}
