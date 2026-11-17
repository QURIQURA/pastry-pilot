#!/usr/bin/env node
// pastry-pilot#20: record Auto-Pilot progress on the YEON OS Development Board.
// Usage: node scripts/dev-board-report.mjs <issue> <STATUS|-> "<note>" [pr]
// Calls yeon_ops.dev_board_record through the Supabase Management API (SUPABASE_ACCESS_TOKEN).
// Never fails the calling workflow: the board is a view, GitHub stays the record.
import { exec, quote } from "./supabase-migrate.mjs";

const [issue, status = "-", note = "", pr = ""] = process.argv.slice(2);
const n = (v) => (/^\d+$/.test(String(v)) && Number(v) > 0 ? String(Number(v)) : "null");
const s = (v) => (v ? quote(v) : "null");

if (!process.env.SUPABASE_ACCESS_TOKEN && !process.env.SUPABASE_DB_URL) {
  console.log("Dev Board report skipped: no Supabase credentials in this step.");
} else if (n(issue) === "null") {
  console.log("Dev Board report skipped: no issue number.");
} else {
  const e = process.env;
  const runUrl = e.GITHUB_RUN_ID
    ? `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}`
    : "";
  const sql = `select yeon_ops.dev_board_record(${s(e.GITHUB_REPOSITORY || "QURIQURA/pastry-pilot")}, ${n(issue)}, ${n(pr)}, ${s(status === "-" ? "" : status)}, ${s(note)}, ${s(runUrl)}, ${s(e.ISSUE_TITLE || "")});`;
  try {
    await exec(sql);
    console.log(`Dev Board updated for #${issue}${status !== "-" ? ` (${status})` : ""}.`);
  } catch (err) {
    // e.g. the board migration is not applied yet.
    console.log(`Dev Board report not recorded: ${String(err.message).slice(0, 200)}`);
  }
}
