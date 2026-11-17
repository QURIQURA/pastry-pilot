import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const b = await loadTs("src/lib/dev-board.ts");

test("parseRef reads GitHub issue and PR URLs and short refs", () => {
  assert.deepEqual(b.parseRef("https://github.com/QURIQURA/pastry-pilot/pull/19"), {
    kind: "PR",
    repo: "QURIQURA/pastry-pilot",
    number: 19,
    url: "https://github.com/QURIQURA/pastry-pilot/pull/19",
    syncKey: "github:QURIQURA/pastry-pilot#19",
  });
  const issue = b.parseRef("https://github.com/QURIQURA/wann-planner/issues/4/");
  assert.equal(issue.kind, "ISSUE");
  assert.equal(issue.url, "https://github.com/QURIQURA/wann-planner/issues/4");
  assert.equal(b.parseRef("#17").url, "https://github.com/QURIQURA/pastry-pilot/issues/17");
  assert.equal(b.parseRef("QURIQURA/shcs-order#3").syncKey, "github:QURIQURA/shcs-order#3");
  assert.equal(
    b.parseRef("https://github.com/QURIQURA/wann-planner/blob/main/YEON_OS_WORKFLOW.md").kind,
    "DOC",
  );
});

test("parseRef rejects non-https links", () => {
  assert.equal(b.parseRef("javascript:alert(1)"), null);
  assert.equal(b.parseRef("http://github.com/a/b/issues/1"), null);
  assert.equal(b.parseRef("   "), null);
});

test("a merged PR suggests MERGED, never DEPLOYED or VERIFIED", () => {
  const merged = [
    { kind: "PR", gh_state: "closed", gh_draft: false, gh_merged_at: "2026-11-17T00:00:00Z" },
  ];
  assert.equal(b.suggestedStatus("PR_OPEN", merged), "MERGED");
  assert.equal(b.suggestedStatus("MERGED", merged), null);
  assert.equal(b.suggestedStatus("DEPLOYED", merged), null);
  assert.equal(b.suggestedStatus("BLOCKED", merged), null);
  const open = [{ kind: "PR", gh_state: "open", gh_draft: true, gh_merged_at: null }];
  assert.equal(b.suggestedStatus("IMPLEMENTING", open), "PR_OPEN");
  assert.equal(b.suggestedStatus("REQUESTED", []), null);
  assert.equal(b.githubStateLabel(open[0]), "draft");
  assert.equal(b.githubStateLabel(merged[0]), "merged");
});

test("filter by OS (owning or affected), status and text; sort by status order", () => {
  const items = [
    {
      work_key: "YOS-002",
      title: "Auto-Pilot",
      goal: null,
      owning_os: "SHARED",
      affected_os: ["PILOT"],
      status: "IMPLEMENTING",
      priority: "P1",
      blocker: null,
      updated_at: "2",
    },
    {
      work_key: "YOS-001",
      title: "Board",
      goal: "track",
      owning_os: "PILOT",
      affected_os: [],
      status: "PR_OPEN",
      priority: "P2",
      blocker: null,
      updated_at: "1",
    },
    {
      work_key: "YOS-010",
      title: "Order form",
      goal: null,
      owning_os: "SHCS",
      affected_os: [],
      status: "REQUESTED",
      priority: "P0",
      blocker: "auth",
      updated_at: "3",
    },
  ];
  const f = (o) =>
    b.filterItems(items, { q: "", os: [], statuses: [], ...o }).map((i) => i.work_key);
  assert.deepEqual(f({ os: ["PILOT"] }), ["YOS-002", "YOS-001"]);
  assert.deepEqual(f({ statuses: ["REQUESTED"] }), ["YOS-010"]);
  assert.deepEqual(f({ q: "AUTH" }), ["YOS-010"]);
  assert.deepEqual(
    b.sortItems(items, "status", "asc").map((i) => i.work_key),
    ["YOS-010", "YOS-002", "YOS-001"],
  );
  assert.deepEqual(
    b.sortItems(items, "work_key", "asc").map((i) => i.work_key),
    ["YOS-001", "YOS-002", "YOS-010"],
  );
  assert.deepEqual(
    b.sortItems(items, "priority", "asc").map((i) => i.work_key),
    ["YOS-010", "YOS-002", "YOS-001"],
  );
});

test("work keys, cross-OS badge and deterministic graph layout", () => {
  assert.equal(b.nextWorkKey(["YOS-001", "YOS-009", "X-3"]), "YOS-010");
  assert.equal(b.nextWorkKey([]), "YOS-001");
  assert.equal(b.isCrossOs({ owning_os: "PILOT", affected_os: ["PILOT"] }), false);
  assert.equal(b.isCrossOs({ owning_os: "PILOT", affected_os: ["SHCS"] }), true);
  const items = [
    { id: "a", owning_os: "PILOT", status: "MERGED", work_key: "YOS-001" },
    { id: "b", owning_os: "PILOT", status: "REQUESTED", work_key: "YOS-002" },
  ];
  assert.deepEqual(b.graphLayout(items), b.graphLayout([...items].reverse()));
  assert.ok(b.graphLayout(items).b.y < b.graphLayout(items).a.y);
});
