// YEON OS Issue #4 — read-only Planner availability for the DASHBOARD daily timeline.
//
// Browser (Pilot owner JWT) → this function → WANN RPC public.pilot_availability (service_role only).
// - Only the Pilot owner may call it (same check as sync-work-session-to-planner).
// - The WANN key stays in this function's secrets (WANN_OS_SERVICE_ROLE_KEY); it never reaches the browser.
// - Planner decides every segment's state; this function only forwards the derived segments.
// - Planner tasks that Pilot itself created (work_blocks / daily_tasks / component rows planner_task_id)
//   are excluded so Pilot work is not counted twice.
// - Always answers 200 with { status: "ok" | "unavailable" } so the UI can show a quiet
//   "Planner availability unavailable" state instead of zero capacity. Never logs schedule data.
import { createClient } from "jsr:@supabase/supabase-js@2";

const WANN_OS_URL = "https://txrxzsrjqwhvjosutotp.supabase.co";
const KORA_OWNER_ID = "53e168e4-72aa-418e-812a-6caaf315a205";
const MAX_RANGE_DAYS = 14;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
const unavailable = (reason: string) => json({ status: "unavailable", reason });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (d: string) =>
  Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: authData, error: authError } = token
      ? await authClient.auth.getUser(token)
      : { data: { user: null }, error: new Error("no token") };
    if (authError || authData.user?.id !== KORA_OWNER_ID)
      return json({ status: "unavailable", reason: "not_authorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const from = String(body?.from ?? "");
    const to = String(body?.to ?? from);
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return unavailable("invalid_range");
    const span = dayNumber(to) - dayNumber(from);
    if (!(span >= 0 && span < MAX_RANGE_DAYS)) return unavailable("invalid_range");

    const wannKey = Deno.env.get("WANN_OS_SERVICE_ROLE_KEY");
    if (!wannKey) return unavailable("not_configured");

    // Pilot-owned Planner task ids (Pilot already shows these on its own timeline).
    const kora = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const [blocks, dailies, rows] = await Promise.all([
      kora.from("work_blocks").select("planner_task_id").not("planner_task_id", "is", null),
      kora.from("daily_tasks").select("planner_task_id").not("planner_task_id", "is", null),
      kora
        .from("work_session_formula_versions")
        .select("planner_task_id")
        .not("planner_task_id", "is", null),
    ]);
    if (blocks.error || dailies.error || rows.error) return unavailable("upstream_error");
    const exclude = [
      ...new Set(
        [...(blocks.data ?? []), ...(dailies.data ?? []), ...(rows.data ?? [])]
          .map((r: { planner_task_id: string | null }) => r.planner_task_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];

    const wann = createClient(WANN_OS_URL, wannKey);
    const { data, error } = await wann.rpc("pilot_availability", {
      p_from: from,
      p_to: to,
      p_exclude_task_ids: exclude,
    });
    if (error || !data) return unavailable("upstream_error");
    return json(data);
  } catch (_e) {
    return unavailable("upstream_error");
  }
});
