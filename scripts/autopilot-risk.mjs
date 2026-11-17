#!/usr/bin/env node
// pastry-pilot#18 YEON OS Auto-Pilot: decide whether a PR is low-risk enough to ever be merged
// without a person. Anything touching the database, auth, secrets, payments, CI/deploy,
// dependencies or cross-OS contracts is "needs-human". The default answer is "needs-human";
// "low" is only given when every changed file matches a known-safe pattern.
//
// CLI: node scripts/autopilot-risk.mjs <base-sha> <head-sha>
// Prints JSON { risk, reasons, files } and writes risk=/reasons= to $GITHUB_OUTPUT when set.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BLOCK_PATHS = [
  [/^supabase\//, "database, edge function or SQL change"],
  [/^\.github\//, "CI / workflow change"],
  [/(^|\/)wrangler\.(json|jsonc|toml)$|^vite\.config\.|^bunfig\.toml$/, "build or deploy config"],
  [/(^|\/)(package\.json|package-lock\.json|bun\.lockb?|bun\.lock)$/, "dependency change"],
  [/^src\/integrations\/supabase\//, "Supabase client / auth / generated types"],
  [/^src\/server\.ts$|^src\/start\.ts$|^src\/router\.tsx$/, "server or router entry"],
  [/^src\/routes\/(__root|auth)\.tsx$|^src\/routes\/_authenticated\/route\.tsx$/, "auth route"],
  [/(auth|secret|token|password|payment|stripe|billing)/i, "auth, secret or payment related path"],
  [
    /(planner-sync|planner-availability|production-sync|order-planner-sync|wann)/i,
    "cross-OS integration",
  ],
  [/^docs\/yeon-os\/|YEON_OS/i, "cross-OS contract document"],
  [/^tests\/known-failures\.txt$/, "known test failure list"],
];

const SAFE_PATHS = [
  /^src\/(components|routes|lib|hooks|widgets)\/.+\.(tsx?|css)$/,
  /^src\/styles\.css$/,
  /^src\/routeTree\.gen\.ts$/,
  /^tests\/.+\.(test\.mjs|mjs)$/,
  /^docs\/.+\.md$/,
  /^(README|CHANGELOG)\.md$/,
  /^public\/.+\.(png|jpe?g|svg|webp|ico|txt)$/,
];

const BLOCK_CONTENT = [
  [
    /\b(drop\s+(table|schema|function|policy|column)|truncate\s|delete\s+from|alter\s+table)\b/i,
    "destructive SQL in diff",
  ],
  [
    /\b(grant|revoke)\s+\w+|security\s+definer|row\s+level\s+security|create\s+policy/i,
    "permission / RLS change in diff",
  ],
  [
    /service_role|SERVICE_ROLE_KEY|secrets\.\w+|process\.env\.|import\.meta\.env\.|Deno\.env\./,
    "secret or environment access in diff",
  ],
  [/\.rpc\(\s*["'`]|functions\.invoke\(/, "new server call (RPC / edge function) in diff"],
];

const MAX_SAFE_FILES = 15;
const MAX_SAFE_LINES = 400;

/** Reasons found in added lines alone (also used for edge function deploys). */
export function classifyContent(addedLines) {
  const text = addedLines.join("\n");
  return BLOCK_CONTENT.filter(([re]) => re.test(text)).map(([, why]) => why);
}

/**
 * @param {{ files: string[], addedLines: string[] }} diff
 * @returns {{ risk: "low" | "needs-human", reasons: string[] }}
 */
export function classify({ files, addedLines }) {
  const reasons = new Set();
  if (files.length === 0) reasons.add("empty diff");
  for (const f of files) {
    for (const [re, why] of BLOCK_PATHS) if (re.test(f)) reasons.add(`${why}: ${f}`);
    if (!SAFE_PATHS.some((re) => re.test(f))) reasons.add(`not on the safe-path list: ${f}`);
  }
  for (const why of classifyContent(addedLines)) reasons.add(why);
  if (files.length > MAX_SAFE_FILES)
    reasons.add(`${files.length} files changed (max ${MAX_SAFE_FILES})`);
  if (addedLines.length > MAX_SAFE_LINES)
    reasons.add(`${addedLines.length} lines added (max ${MAX_SAFE_LINES})`);
  return { risk: reasons.size ? "needs-human" : "low", reasons: [...reasons] };
}

function gitDiff(base, head) {
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const files = git("diff", "--name-only", `${base}...${head}`).split("\n").filter(Boolean);
  const addedLines = git("diff", "--unified=0", `${base}...${head}`)
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
  return { files, addedLines };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error("usage: autopilot-risk.mjs <base-sha> <head-sha>");
    process.exit(2);
  }
  const diff = gitDiff(base, head);
  const result = classify(diff);
  console.log(JSON.stringify({ ...result, files: diff.files }, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `risk=${result.risk}\nreasons<<EOF_REASONS\n${result.reasons.map((r) => `- ${r}`).join("\n") || "- none"}\nEOF_REASONS\n`,
    );
  }
}
