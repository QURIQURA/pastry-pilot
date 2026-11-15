import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const lib = await loadTs("src/lib/planner-availability.ts");
const seg = (start, end, state, label = state) => ({
  start,
  end,
  state,
  label,
  reason: "childcare",
  carer: null,
  override: false,
});
const m = (hhmm) => lib.hhmmToMin(hhmm);

// Friday with Sage 10-16, unknown 8-10 and 16-20, check outside 08-20
const friday = [
  seg("00:00", "08:00", "check"),
  seg("08:00", "10:00", "unknown", "Tanji · Unassigned"),
  seg("10:00", "16:00", "available", "Tanji at Sage"),
  seg("16:00", "20:00", "unknown", "Tanji · Unassigned"),
  seg("20:00", "24:00", "check", "Outside Planner hours"),
];

test("capacity: available, allocated (overlaps once), remaining, check, outside", () => {
  const work = [
    { start: m("10:00"), end: m("12:00") }, // block
    { start: m("11:00"), end: m("12:30") }, // overlapping daily task counted once
    { start: m("15:30"), end: m("16:30") }, // straddles band edge: 30m inside, 30m outside
    { start: m("06:00"), end: m("07:00") }, // early-morning work: outside available
  ];
  const s = lib.summarizeCapacity(friday, work);
  assert.equal(s.available, 360);
  assert.equal(s.allocated, 150 + 30);
  assert.equal(s.remaining, 180);
  assert.equal(s.check, 8 * 60 + 4 * 60);
  assert.equal(s.outside, 30 + 60);
});

test("capacity never negative and empty work is all remaining", () => {
  assert.deepEqual(lib.summarizeCapacity(friday, []).remaining, 360);
  const over = lib.summarizeCapacity(
    [seg("10:00", "11:00", "available")],
    [{ start: 0, end: 1440 }],
  );
  assert.equal(over.remaining, 0);
});

test("conflict: worst overlapped state wins; fully available has none", () => {
  assert.equal(lib.conflictFor(friday, { start: m("10:00"), end: m("11:00") }), null);
  assert.equal(lib.conflictFor(friday, { start: m("09:30"), end: m("10:30") }).state, "unknown");
  assert.equal(lib.conflictFor(friday, { start: m("19:30"), end: m("20:30") }).state, "unknown");
  assert.equal(lib.conflictFor(friday, { start: m("21:00"), end: m("22:00") }).state, "check");
  const withBusy = [...friday, seg("10:30", "11:00", "busy", "Planner schedule")];
  const c = lib.conflictFor(withBusy, { start: m("09:00"), end: m("11:00") });
  assert.equal(c.state, "busy");
  assert.deepEqual(c.labels, ["Planner schedule"]);
});

test("parse: errors and malformed bodies become unavailable, never free time", () => {
  assert.equal(lib.parseAvailabilityResponse(null).status, "unavailable");
  assert.deepEqual(
    lib.parseAvailabilityResponse({ status: "unavailable", reason: "not_configured" }),
    {
      status: "unavailable",
      reason: "not_configured",
    },
  );
  assert.equal(lib.parseAvailabilityResponse({ status: "ok" }).status, "unavailable");
  assert.equal(
    lib.parseAvailabilityResponse({
      status: "ok",
      days: [{ date: "2026-11-20", segments: [{ start: "x" }] }],
    }).status,
    "unavailable",
  );
  const ok = lib.parseAvailabilityResponse({
    status: "ok",
    timezone: "Australia/Sydney",
    updated_at: "2026-11-15T00:00:00Z",
    days: [{ date: "2026-11-20", segments: friday }],
  });
  assert.equal(ok.status, "ok");
  assert.equal(ok.days[0].segments.length, 5);
});

test("formatMinutes", () => {
  assert.equal(lib.formatMinutes(0), "0m");
  assert.equal(lib.formatMinutes(45), "45m");
  assert.equal(lib.formatMinutes(360), "6h");
  assert.equal(lib.formatMinutes(270), "4h 30m");
});
