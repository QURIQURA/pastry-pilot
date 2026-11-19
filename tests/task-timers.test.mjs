import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const { taskTimerSummary, timerElapsedSec } = await loadTs("src/lib/task-timers.ts");
const { formatDateTime } = await loadTs("src/lib/datetime.ts");

test("actual timer timestamps and elapsed time survive Sydney midnight", () => {
  const start = "2026-11-20T12:55:00.000Z";
  const end = "2026-11-20T13:05:00.000Z";
  const timer = { id: "timer", label: "bake", minutes: null, started_at: start, done_at: null };
  assert.equal(formatDateTime(start), "2026-11-20 23:55");
  assert.equal(formatDateTime(end), "2026-11-21 00:05");
  assert.deepEqual(taskTimerSummary([timer]), {
    runningCount: 1,
    actual_started_at: start,
    completed_at: null,
  });
  assert.equal(taskTimerSummary([timer, { ...timer, id: "another" }]).runningCount, 2);
  assert.deepEqual(taskTimerSummary([{ ...timer, done_at: end }]), {
    runningCount: 0,
    actual_started_at: start,
    completed_at: end,
  });
  assert.equal(timerElapsedSec(timer, new Date(end)), 600);
});
