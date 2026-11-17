// Redeploy after CI confirmation fix (2026-11-17); no runtime behavior change.
// YEON OS Development Board (pastry-pilot#17) — read-only GitHub issue/PR snapshot.
//
// Browser (signed-in user JWT) → this function → GitHub REST API (GET only) → the caller's own
// dev_work_refs rows (written with the caller's JWT, so RLS still applies).
// - GitHub stays the source of truth; we cache title/state/draft/merged/labels for display only.
//   Board status is never changed here (merged ≠ deployed ≠ verified).
// - Optional secret GITHUB_READ_TOKEN (fine-grained, read-only Issues + Pull requests) for private
//   repos and higher rate limits. Without it, public repos still sync anonymously.
//   The token never reaches the browser and is never logged.
// - Only repos in ALLOWED_REPOS are fetched. At most MAX_REFS refs per call.
// - Always answers 200 with { status: "ok" | "unavailable", ... } except 401 for bad auth.
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_REPOS = new Set([
  "QURIQURA/pastry-pilot",
  "QURIQURA/wann-planner",
  "QURIQURA/shcs-order",
  "QURIQURA/secret-occasion-cakes",
  "QURIQURA/kora-pilot",
]);
const MAX_REFS = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type GhIssue = {
  title?: string;
  state?: string;
  draft?: boolean;
  labels?: { name?: string }[];
  updated_at?: string;
  pull_request?: { merged_at?: string | null };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ status: "unavailable", reason: "not_authorized" }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await db.auth.getUser(token);
    if (authError || !authData.user)
      return json({ status: "unavailable", reason: "not_authorized" }, 401);

    const { data: refs, error } = await db
      .from("dev_work_refs")
      .select("id, repo, number, kind")
      .in("kind", ["ISSUE", "PR"])
      .not("repo", "is", null)
      .not("number", "is", null)
      .order("synced_at", { ascending: true, nullsFirst: true })
      .limit(MAX_REFS);
    if (error) return json({ status: "unavailable", reason: "db_error" });

    const ghToken = Deno.env.get("GITHUB_READ_TOKEN");
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pilot-dev-board",
    };
    if (ghToken) headers.Authorization = `Bearer ${ghToken}`;

    let synced = 0;
    const failed: { id: string; reason: string }[] = [];
    for (const ref of refs ?? []) {
      const repo = String(ref.repo);
      const now = new Date().toISOString();
      if (!ALLOWED_REPOS.has(repo)) {
        failed.push({ id: ref.id, reason: "repo_not_allowed" });
        await db
          .from("dev_work_refs")
          .update({ sync_error: "repo_not_allowed", synced_at: now })
          .eq("id", ref.id);
        continue;
      }
      // The issues endpoint answers for both issues and PRs; PRs need one more call for draft/merged.
      const res = await fetch(`https://api.github.com/repos/${repo}/issues/${ref.number}`, {
        headers,
      });
      if (res.status === 403 || res.status === 429) {
        failed.push({ id: ref.id, reason: "rate_limited" });
        break;
      }
      if (!res.ok) {
        const reason =
          res.status === 404
            ? ghToken
              ? "not_found"
              : "not_found_or_private"
            : `http_${res.status}`;
        failed.push({ id: ref.id, reason });
        await db
          .from("dev_work_refs")
          .update({ sync_error: reason, synced_at: now })
          .eq("id", ref.id);
        continue;
      }
      const issue = (await res.json()) as GhIssue;
      const isPr = Boolean(issue.pull_request);
      let draft: boolean | null = null;
      let mergedAt: string | null = issue.pull_request?.merged_at ?? null;
      if (isPr) {
        const pr = await fetch(`https://api.github.com/repos/${repo}/pulls/${ref.number}`, {
          headers,
        });
        if (pr.ok) {
          const body = (await pr.json()) as { draft?: boolean; merged_at?: string | null };
          draft = Boolean(body.draft);
          mergedAt = body.merged_at ?? mergedAt;
        }
      }
      const { error: upErr } = await db
        .from("dev_work_refs")
        .update({
          kind: isPr ? "PR" : "ISSUE",
          title: (issue.title ?? "").slice(0, 300) || null,
          gh_state: issue.state ?? null,
          gh_draft: draft,
          gh_merged_at: mergedAt,
          gh_labels: (issue.labels ?? [])
            .map((l) => String(l.name ?? ""))
            .filter(Boolean)
            .slice(0, 20),
          gh_updated_at: issue.updated_at ?? null,
          synced_at: now,
          sync_error: null,
        })
        .eq("id", ref.id);
      if (upErr) failed.push({ id: ref.id, reason: "db_error" });
      else synced++;
    }
    return json({ status: "ok", synced, failed, authenticated: Boolean(ghToken) });
  } catch (_e) {
    return json({ status: "unavailable", reason: "internal_error" });
  }
});
