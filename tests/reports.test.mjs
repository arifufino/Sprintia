import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, totals } from "../app/lib/reports.ts";
const task = (id, points, status = "todo", sprintId = "s") => ({ id, code: id.toUpperCase(), points, status, sprintId });
const at = (day) => `2026-10-${String(day).padStart(2, "0")}T15:00:00.000Z`;
const start = (tasks) => ({ version: 1, sequence: 1, kind: "start", sprintId: "s", sprintIds: ["s"], at: at(1), baseline: tasks });
const change = (sequence, before, after, date = at(sequence)) => ({ version: 1, sequence, kind: "task", sprintIds: ["s"], at: date, metricBefore: before, metricAfter: after });
const project = (baseline, events, finalTasks, extra = {}) => buildTimeline({ sprintId: "s", status: "active", baseline, events, finalTasks, asOf: at(10), ...extra });

test("reports: remaining work is not confused with scope removal or completion", () => {
  const a = task("a", 3), b = task("b", 5), done = { ...a, status: "done" };
  const report = project(start([a, b]), [change(2, a, done), change(3, b, { ...b, sprintId: null, status: "backlog" })], [done]);
  assert.equal(report.coverage, "complete"); assert.equal(report.initial.scope.points, 8); assert.equal(report.current.done.points, 3); assert.equal(report.current.pending.tasks, 0); assert.equal(report.deltas.removed.points, 5); assert.deepEqual(report.changes[1].kinds, ["removed"]);
});
test("reports: additions and reestimation preserve the initial estimate and unknown work", () => {
  const a = task("a", null), estimated = { ...a, points: 5 }, b = task("b", 3);
  const report = project(start([a]), [change(2, a, estimated), change(3, null, b)], [estimated, b]);
  assert.equal(report.coverage, "complete"); assert.equal(report.initial.scope.unestimated, 1); assert.equal(report.initial.scope.points, 0); assert.equal(report.current.scope.points, 8); assert.equal(report.deltas.reestimated, 1); assert.equal(report.deltas.knownPointsDelta, 5); assert.equal(report.deltas.added.points, 3);
});
test("reports: reopen and re-complete are transitions, not unique deliveries", () => {
  const a = task("a", 3), done = { ...a, status: "done" };
  const report = project(start([a]), [change(2, a, done), change(3, done, a), change(4, a, done)], [done]);
  assert.equal(report.deltas.reopened, 1); assert.equal(report.current.done.tasks, 1); assert.equal(report.changes.filter((c) => c.kinds.includes("completed")).length, 2);
});
test("reports: deleting even completed work is a removal, not another completion", () => {
  const a = task("a", 3, "done"); const report = project(start([a]), [change(2, a, null)], []);
  assert.equal(report.coverage, "complete"); assert.deepEqual(report.changes[0].kinds, ["removed"]); assert.equal(report.changes[0].deleted, true); assert.equal(report.current.done.tasks, 0);
});
test("reports: entering already-done work is scope, not a new completion", () => {
  const a = task("a", 3, "done"); const report = project(start([]), [change(2, null, a)], [a]); assert.equal(report.coverage, "complete"); assert.deepEqual(report.changes[0].kinds, ["added"]);
});
test("reports: a missing baseline cannot fabricate a historical curve", () => {
  const a = task("a", 3); const report = project(null, [], [a]); assert.equal(report.coverage, "none"); assert.equal(report.initial, null); assert.deepEqual(report.samples, []); assert.equal(report.current.pending.tasks, 1);
});
test("reports: discontinuities, missing writes and non-monotonic clocks hide the curve", () => {
  const a = task("a", 3), done = { ...a, status: "done" };
  for (const options of [{ finalTasks: [done] }, { untracked: true }, { events: [change(2, { ...a, points: 5 }, done)], finalTasks: [done] }, { asOf: "2026-09-01T00:00:00.000Z" }]) {
    const report = project(start([a]), [], [a], options); assert.equal(report.coverage, "partial"); assert.deepEqual(report.samples, []);
  }
});
test("reports: equal timestamps use operation sequence and retain the initial cut", () => {
  const a = task("a", 3), b = { ...a, points: 5 }, done = { ...b, status: "done" };
  const report = project(start([a]), [change(3, b, done, at(1)), change(2, a, b, at(1))], [done], { asOf: at(1) });
  assert.equal(report.coverage, "complete"); assert.equal(report.samples[0].totals.scope.points, 3); assert.equal(report.samples.at(-1).totals.done.points, 5);
});
test("reports: daily boundaries are Ecuador midnight and future days are not filled", () => {
  const a = task("a", 3); const report = project(start([a]), [], [a], { asOf: at(3) });
  assert.deepEqual(report.samples.map((s) => s.at), [at(1), "2026-10-02T05:00:00.000Z", "2026-10-03T05:00:00.000Z", at(3)]);
});
test("reports: long intervals stay bounded and truncated/planned series stay explicit", () => {
  const a = task("a", 3); const report = project(start([a]), [], [a], { asOf: "2036-10-01T00:00:00.000Z" }); assert.ok(report.samples.length < 185); assert.ok(report.intervalDays > 1);
  for (const [options, coverage] of [[{ limited: true }, "limit"], [{ status: "planned" }, "planned"]]) { const result = project(start([a]), [], [a], options); assert.equal(result.coverage, coverage); assert.deepEqual(result.samples, []); }
  assert.deepEqual(totals([]), { scope: { tasks: 0, points: 0, unestimated: 0 }, pending: { tasks: 0, points: 0, unestimated: 0 }, done: { tasks: 0, points: 0, unestimated: 0 } });
});
