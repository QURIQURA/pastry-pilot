#!/usr/bin/env node
// pastry-pilot#18: which PILOT edge functions to deploy, and whether that needs the owner's approval.
// Only functions listed as [functions.<name>] in supabase/config.toml are ever deployed from here
// (that list pins verify_jwt to what is live). SHCS functions in the same project are never touched.
// Usage: node scripts/supabase-functions-plan.mjs <base-sha|-> <head-sha> <changed|all|"a b">
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyContent } from "./autopilot-risk.mjs";

export function configuredFunctions(toml) {
  return [...toml.matchAll(/^\[functions\.([a-z0-9-]+)\]/gm)].map((m) => m[1]);
}

/** A brand-new function, or added lines touching auth/secrets/env/RPC, needs approval. */
export function functionRisk({ isNew, addedLines }) {
  const reasons = classifyContent(addedLines);
  if (isNew) reasons.unshift("new edge function");
  return { risk: reasons.length ? "high" : "low", reasons };
}

function main() {
  const [base, head, which = "changed"] = process.argv.slice(2);
  const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const allowed = configuredFunctions(readFileSync("supabase/config.toml", "utf8")).filter((f) =>
    existsSync(`supabase/functions/${f}/index.ts`),
  );
  const hasBase = base && base !== "-" && !/^0+$/.test(base);
  let names;
  if (which === "all") names = allowed;
  else if (which === "changed") {
    const changed = hasBase
      ? git("diff", "--name-only", base, head, "--", "supabase/functions")
      : git("show", "--name-only", "--format=", head, "--", "supabase/functions");
    names = [
      ...new Set(
        changed
          .split("\n")
          .map((p) => p.split("/")[2])
          .filter(Boolean),
      ),
    ];
  } else names = which.split(/\s+/).filter(Boolean);
  const skipped = names.filter((n) => !allowed.includes(n));
  names = names.filter((n) => allowed.includes(n));

  const plan = names.map((name) => {
    const dir = `supabase/functions/${name}`;
    let isNew = !hasBase;
    let added = [];
    if (hasBase) {
      isNew = !git("ls-tree", "-r", "--name-only", base, "--", dir).trim();
      added = git("diff", "--unified=0", base, head, "--", dir)
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1));
    } else added = readFileSync(`${dir}/index.ts`, "utf8").split("\n");
    return { name, ...functionRisk({ isNew, addedLines: added }) };
  });
  const risk = plan.some((p) => p.risk === "high") ? "high" : plan.length ? "low" : "none";
  const summary = plan.length
    ? plan
        .map((p) => `- ${p.name}: ${p.risk}${p.reasons.length ? ` (${p.reasons.join(", ")})` : ""}`)
        .join("\n")
    : "- no edge functions to deploy";
  console.log(`Function risk: ${risk}\n${summary}`);
  if (skipped.length)
    console.log(`Not deployed from this repo (not in config.toml): ${skipped.join(", ")}`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `risk=${risk}\nnames=${plan.map((p) => p.name).join(" ")}\nsummary<<EOF_OUT\n${summary}\nEOF_OUT\n`,
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
