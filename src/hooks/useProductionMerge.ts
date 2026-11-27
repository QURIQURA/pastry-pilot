import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { legacyBatchEntries, nextProductionMerge } from "@/lib/production-merge-state";

const BATCH_EVENT = "pilot:production-batches";
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const legacyAttempts = new Set<string>();
type MemberMap = Map<string, string>;
const queryKey = (day: string) => ["production_merge_members", day] as const;
const legacyKey = (day: string) => `pilot:production-batches:${day}`;

function readLegacy(day: string): MemberMap {
  try {
    return new Map(legacyBatchEntries(JSON.parse(localStorage.getItem(legacyKey(day)) ?? "[]")));
  } catch {
    return new Map();
  }
}
function cacheLegacy(day: string, members: ReadonlyMap<string, string>) {
  try {
    localStorage.setItem(legacyKey(day), JSON.stringify([...members]));
  } catch {
    // Legacy backup is optional; the Supabase table remains authoritative.
  }
}
function parseMembers(value: unknown): MemberMap {
  return new Map(legacyBatchEntries(value));
}

/**
 * Production batching belongs to PILOT and is now stored in Supabase.
 * The original localStorage state is imported non-destructively for each day.
 * Cross-device updates are polled and refetched on window focus. The server
 * performs join/unmerge atomically and validates formula-version consistency.
 */
export function useProductionMerge(day: string) {
  const client = useQueryClient();
  const isScheduledDay = DAY_PATTERN.test(day);
  const [legacyState, setLegacyState] = useState<{ day: string; members: MemberMap }>(() => ({
    day,
    members: readLegacy(day),
  }));
  useEffect(() => {
    setLegacyState({ day, members: readLegacy(day) });
  }, [day]);

  const query = useQuery({
    queryKey: queryKey(day),
    enabled: isScheduledDay,
    staleTime: 3_000,
    refetchInterval: 10_000,
    queryFn: async (): Promise<MemberMap> => {
      const { data, error } = await supabase
        .from("production_merge_members" as never)
        .select("selection_id,batch_id")
        .eq("work_date", day);
      if (error) throw error;
      return new Map(
        ((data ?? []) as { selection_id: string; batch_id: string }[]).map((row) => [
          row.selection_id,
          row.batch_id,
        ]),
      );
    },
  });

  const local = legacyState.day === day ? legacyState.members : readLegacy(day);
  const batchBySelection = useMemo(() => {
    if (!isScheduledDay || !query.isSuccess) return local;
    // Once fetched, the database is authoritative, including an intentionally
    // empty batch after unmerge. Old localStorage must never resurrect it.
    return query.data;
  }, [day, isScheduledDay, local, query.data, query.isSuccess]);

  useEffect(() => {
    if (!isScheduledDay || !query.isSuccess || legacyAttempts.has(day)) return;
    const entries = [...readLegacy(day)];
    const counts = new Map<string, number>();
    for (const [, batch] of entries) counts.set(batch, (counts.get(batch) ?? 0) + 1);
    const eligible = entries.filter(([, batch]) => (counts.get(batch) ?? 0) > 1);
    if (!eligible.length) return;
    legacyAttempts.add(day);
    void supabase
      .rpc(
        "production_merge_import_legacy" as never,
        {
          p_work_date: day,
          p_entries: eligible,
        } as never,
      )
      .then(({ error }) => {
        if (error) {
          toast.error(`기존 병합 가져오기 실패: ${error.message}`);
        }
        void client.invalidateQueries({ queryKey: queryKey(day) });
      });
  }, [client, day, isScheduledDay, query.isSuccess]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const changed = event instanceof CustomEvent ? event.detail : (event as StorageEvent).key;
      if (changed === day || changed === legacyKey(day)) {
        void client.invalidateQueries({ queryKey: queryKey(day) });
      }
    };
    window.addEventListener(BATCH_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(BATCH_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [client, day]);

  const setBatch = (ids: string[]) => {
    if (!ids.length) return;
    if (!isScheduledDay) {
      const next = nextProductionMerge(local, ids, () => crypto.randomUUID());
      setLegacyState({ day, members: next });
      cacheLegacy(day, next);
      return;
    }
    if (!query.isSuccess) {
      toast.error("서버 병합 정보를 불러오지 못했어요. 다시 시도해 주세요.");
      return;
    }
    const before = new Map(batchBySelection);
    const next = nextProductionMerge(before, ids, () => crypto.randomUUID());
    client.setQueryData(queryKey(day), next);
    setLegacyState({ day, members: next });
    void supabase
      .rpc(
        "production_merge_change" as never,
        {
          p_work_date: day,
          p_selection_ids: ids,
        } as never,
      )
      .then(({ data, error }) => {
        if (error) {
          toast.error(`병합 저장 실패: ${error.message}`);
          client.setQueryData(queryKey(day), before);
          setLegacyState({ day, members: before });
        } else {
          const saved = parseMembers(data);
          client.setQueryData(queryKey(day), saved);
          setLegacyState({ day, members: saved });
          cacheLegacy(day, saved);
          window.dispatchEvent(new CustomEvent(BATCH_EVENT, { detail: day }));
        }
        void client.invalidateQueries({ queryKey: queryKey(day) });
      });
  };
  return { batchBySelection, setBatch };
}
