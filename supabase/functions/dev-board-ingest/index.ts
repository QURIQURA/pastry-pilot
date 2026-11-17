// pastry-pilot#18 YEON OS Auto-Pilot → Development Board progress records.
//
// GitHub Actions (header x-yeon-ingest-token = secret DEV_BOARD_INGEST_TOKEN) → this function →
// the PILOT owner's dev_work_items / dev_work_refs. Idempotent: an issue maps to one board item via
// sync key github:<repo>#<issue>; repeated calls update it instead of creating duplicates.
// - Only allowlisted repositories; only CI statuses (never VERIFIED: that needs a person's evidence).
// - Notes are short, plain text from our own workflows. Never send secrets or customer data here.
// - The token and request body are never logged.
import { createClient } from "jsr:@supabase/supabase-js@2";

const KORA_OWNER_ID = "53e168e4-72aa-418e-812a-6caaf315a205";
const REPO_OS: Record<string, string> = {
  "QURIQURA/pastry-pilot": "PILOT",
  "QURIQURA/shcs-order": "SHCS",
  "QURIQURA/wann-planner": "PLANNER",
};
const CI_STATUSES = new Set([
  "IMPLEMENTING",
  "PR_OPEN",
  "REVIEWING",
  "MERGED",
  "DEPLOYED",
  "BLOCKED",
  "FAILED",
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const posInt = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n).trim() : "");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ status: "error", reason: "method" }, 405);
  const expected = Deno.env.get("DEV_BOARD_INGEST_TOKEN") ?? "";
  const given = req.headers.get("x-yeon-ingest-token") ?? "";
  if (!expected || !safeEqual(given, expected))
    return json({ status: "error", reason: "not_authorized" }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const repo = clip(body.repo, 100);
    const issue = posInt(body.issue_number);
    const pr = posInt(body.pr_number);
    const status = clip(body.status, 20);
    const note = clip(body.note, 500);
    const title = clip(body.title, 200);
    const runUrl = clip(body.run_url, 300);
    if (!REPO_OS[repo]) return json({ status: "error", reason: "repo_not_allowed" }, 400);
    if (!issue) return json({ status: "error", reason: "issue_required" }, 400);
    if (status && !CI_STATUSES.has(status))
      return json({ status: "error", reason: "bad_status" }, 400);
    if (runUrl && !runUrl.startsWith("https://github.com/"))
      return json({ status: "error", reason: "bad_run_url" }, 400);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const issueKey = `github:${repo}#${issue}`;
    const { data: ref } = await db
      .from("dev_work_refs")
      .select("work_item_id")
      .eq("user_id", KORA_OWNER_ID)
      .eq("sync_key", issueKey)
      .limit(1)
      .maybeSingle();

    let itemId = ref?.work_item_id as string | undefined;
    if (!itemId) {
      for (let attempt = 0; attempt < 3 && !itemId; attempt++) {
        const { data: keys } = await db
          .from("dev_work_items")
          .select("work_key")
          .eq("user_id", KORA_OWNER_ID)
          .like("work_key", "YOS-%");
        const max = (keys ?? []).reduce((m: number, k: { work_key: string }) => {
          const n = Number(/^YOS-(\d+)$/.exec(k.work_key)?.[1] ?? 0);
          return Math.max(m, n);
        }, 0);
        const { data: created, error } = await db
          .from("dev_work_items")
          .insert({
            user_id: KORA_OWNER_ID,
            work_key: `YOS-${String(max + 1).padStart(3, "0")}`,
            title: title || `${repo.split("/")[1]} #${issue}`,
            owning_os: REPO_OS[repo],
            affected_os: [REPO_OS[repo]],
            status: status || "IMPLEMENTING",
          })
          .select("id")
          .single();
        if (created) itemId = created.id;
        else if (error?.code !== "23505") return json({ status: "error", reason: "db_error" }, 500);
      }
      if (!itemId) return json({ status: "error", reason: "db_conflict" }, 500);
      await db.from("dev_work_refs").upsert(
        {
          user_id: KORA_OWNER_ID,
          work_item_id: itemId,
          kind: "ISSUE",
          repo,
          number: issue,
          url: `https://github.com/${repo}/issues/${issue}`,
          sync_key: issueKey,
        },
        { onConflict: "work_item_id,sync_key", ignoreDuplicates: true },
      );
    }

    if (pr) {
      await db.from("dev_work_refs").upsert(
        {
          user_id: KORA_OWNER_ID,
          work_item_id: itemId,
          kind: "PR",
          repo,
          number: pr,
          url: `https://github.com/${repo}/pull/${pr}`,
          sync_key: `github:${repo}#${pr}`,
        },
        { onConflict: "work_item_id,sync_key", ignoreDuplicates: true },
      );
    }

    const patch: Record<string, unknown> = {};
    if (status) patch.status = status;
    if (note) {
      const { data: cur } = await db
        .from("dev_work_items")
        .select("implementation_notes")
        .eq("id", itemId)
        .single();
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const line = `[${stamp} UTC] ${note}${runUrl ? ` (${runUrl})` : ""}`;
      // Keep the newest ~40 lines so the field stays readable.
      const lines = [
        line,
        ...String(cur?.implementation_notes ?? "")
          .split("\n")
          .filter(Boolean),
      ];
      patch.implementation_notes = lines.slice(0, 40).join("\n");
    }
    if (Object.keys(patch).length) {
      const { error } = await db.from("dev_work_items").update(patch).eq("id", itemId);
      if (error) return json({ status: "error", reason: "db_error" }, 500);
    }
    return json({ status: "ok", item_id: itemId });
  } catch (_e) {
    return json({ status: "error", reason: "internal_error" }, 500);
  }
});
