import type { ClientSession } from "mongodb";
import client from "../lib/mongodb";
import { buildTimeline, measure, taskMetric, totals, type MetricTask, type ReportEvent, type SprintReport, type TrendRow } from "../app/lib/reports";
import type { AppUser, Sprint } from "../app/lib/types";
import { database, isMember, WorkspaceUnavailableError } from "./runtime";
type SprintDoc = Omit<Sprint, "id"> & { _id: string };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const metric = (v: unknown): v is MetricTask => object(v) && typeof v.id === "string" && typeof v.code === "string" && (v.sprintId === null || typeof v.sprintId === "string") && ["backlog", "todo", "progress", "review", "done"].includes(String(v.status)) && (v.points === null || [1, 2, 3, 5, 8, 13].includes(Number(v.points)) && typeof v.points === "number");
function reporting(v: unknown): v is ReportEvent {
  if (!object(v) || v.version !== 1 || !Number.isSafeInteger(v.sequence) || Number(v.sequence) < 1 || typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at)) || !Array.isArray(v.sprintIds) || !v.sprintIds.every((id) => typeof id === "string")) return false;
  if (v.kind === "task") return (v.metricBefore === null || metric(v.metricBefore)) && (v.metricAfter === null || metric(v.metricAfter)) && !!(v.metricBefore || v.metricAfter) && (!v.metricBefore || !v.metricAfter || (v.metricBefore as MetricTask).id === (v.metricAfter as MetricTask).id);
  if (v.kind === "start") return typeof v.sprintId === "string" && (v.baseline === null || Array.isArray(v.baseline) && v.baseline.length <= 2000 && v.baseline.every(metric) && new Set(v.baseline.map((t) => t.id)).size === v.baseline.length && v.baseline.every((t) => t.sprintId === v.sprintId && t.status !== "backlog"));
  return v.kind === "end" && typeof v.sprintId === "string";
}
export async function getSprintReport(user: AppUser, workspaceId: string, sprintId: string, before?: number | null): Promise<SprintReport> {
  const db = await database();
  // One read snapshot: a simultaneous task change or closure cannot mix new
  // counters with old events. This transaction never writes or creates history.
  return client.withSession((session) => session.withTransaction(() => readReport(session), { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: 20_000 }));
  async function readReport(session: ClientSession): Promise<SprintReport> {
    if (!(await isMember(workspaceId, user.id, session))) throw new WorkspaceUnavailableError();
    const sprints = db.collection<SprintDoc>("sprints"), activities = db.collection("activities");
    const projection = { name: 1, status: 1, startedAt: 1, "outcome.endedAt": 1, "outcome.tasks.id": 1, "outcome.tasks.code": 1, "outcome.tasks.status": 1, "outcome.tasks.points": 1, "outcome.tasks.returnedToBacklog": 1 };
    const sprint = await sprints.findOne({ _id: sprintId, workspaceId }, { session, projection }); if (!sprint) throw new WorkspaceUnavailableError();
    const startRow = await activities.findOne({ workspaceId, "event.type": "sprint.started", "event.entityId": sprintId }, { session, sort: { createdAt: 1, _id: 1 }, projection: { "event.changes.reporting.after": 1, createdAt: 1 } });
    const start = startRow?.event?.changes?.reporting?.after;
    const baseline = reporting(start) && start.kind === "start" && start.sprintId === sprintId ? start : null;
    const ended = ["completed", "cancelled"].includes(sprint.status);
    const asOf = ended && sprint.outcome ? sprint.outcome.endedAt : new Date().toISOString();
    const endRow = ended ? await activities.findOne({ workspaceId, "event.type": { $in: ["sprint.completed", "sprint.cancelled"] }, "event.entityId": sprintId }, { session, projection: { "event.changes.reporting.after": 1 } }) : null;
    const end = endRow?.event?.changes?.reporting?.after;
    const endSequence = reporting(end) && end.kind === "end" ? end.sequence : null;
    const sequence = { ...(baseline ? { $gt: baseline.sequence } : {}), ...(endSequence ? { $lt: endSequence } : {}) };
    const rows = sprint.status === "planned" ? [] : await activities.find({ workspaceId, "event.changes.reporting.after.sprintIds": sprintId, ...(Object.keys(sequence).length ? { "event.changes.reporting.after.sequence": sequence } : {}), "event.changes.reporting.after.kind": "task", "event.changes.reporting.after.at": { $lte: asOf } }, { session, batchSize: 10001, projection: { "event.changes.reporting.after": 1 } }).sort({ "event.changes.reporting.after.sequence": 1 }).limit(10001).toArray();
    const events = rows.slice(0, 10000).map((row) => row.event?.changes?.reporting?.after).filter(reporting);
    let untracked = events.length !== Math.min(rows.length, 10000);
    if (baseline) {
      // Conservatively flag mixed-version/unmeasured metric writes. Content-only
      // changes, conversations and ceremonies cannot change this chart.
      const missing = await activities.findOne({ workspaceId, createdAt: { $gte: baseline.at, $lte: asOf }, "event.changes.reporting": { $exists: false }, $or: [{ "event.type": { $in: ["task.created", "task.deleted", "review.decision.converted"] } }, { "event.type": "task.updated", $or: [{ "event.changes.status": { $exists: true } }, { "event.changes.sprintId": { $exists: true } }, { "event.changes.points": { $exists: true } }] }] }, { session, projection: { _id: 1 } });
      untracked ||= !!missing;
    }
    const taskRows = ended && sprint.outcome ? sprint.outcome.tasks.map((t) => ({ ...taskMetric({ ...t, sprintId }), sprintId })) : await db.collection<{ _id: string; code: string; sprintId: string; status: string; points?: number | null }>("tasks").find({ workspaceId, sprintId, status: { $ne: "backlog" } }, { session, batchSize: 2001, projection: { _id: 1, code: 1, sprintId: 1, status: 1, points: 1 } }).limit(2001).toArray();
    const finalTasks = taskRows.map(taskMetric);
    const largeScope = !ended && taskRows.length > 2000;
    const timeline = buildTimeline({ sprintId, status: sprint.status, baseline, events, finalTasks, asOf, limited: rows.length > 10000 || largeScope, untracked });
    if (largeScope) {
      // Exact current totals still come from the full authorized scope. Never
      // present a truncated set of 2,001 tasks as the project's actual total.
      const [row] = await db.collection("tasks").aggregate<{ tasks: number; points: number; unknown: number; done: number; donePoints: number; doneUnknown: number }>([
        { $match: { workspaceId, sprintId, status: { $ne: "backlog" } } },
        { $group: { _id: null, tasks: { $sum: 1 }, points: { $sum: { $ifNull: ["$points", 0] } }, unknown: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$points", null] }, null] }, 1, 0] } }, done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } }, donePoints: { $sum: { $cond: [{ $eq: ["$status", "done"] }, { $ifNull: ["$points", 0] }, 0] } }, doneUnknown: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "done"] }, { $eq: [{ $ifNull: ["$points", null] }, null] }] }, 1, 0] } } } },
      ], { session }).toArray();
      timeline.current = { scope: { tasks: row.tasks, points: row.points, unestimated: row.unknown }, done: { tasks: row.done, points: row.donePoints, unestimated: row.doneUnknown }, pending: { tasks: row.tasks - row.done, points: row.points - row.donePoints, unestimated: row.unknown - row.doneUnknown } };
      timeline.reason = "El alcance observado supera las 2.000 tareas de la proyección. Se muestran totales actuales exactos, sin dibujar una serie truncada.";
    }
    if (ended && !sprint.outcome) { timeline.current = null; timeline.coverage = "none"; timeline.reason = "Este sprint antiguo no conserva un resultado de cierre. No usamos las tareas actuales para inventar su resultado histórico."; timeline.samples = []; timeline.initial = null; }
    const total = await sprints.countDocuments({ workspaceId, status: { $in: ["completed", "cancelled"] } }, { session });
    const closed = await sprints.find({ workspaceId, status: { $in: ["completed", "cancelled"] } }, { session, sort: { "outcome.endedAt": -1, _id: -1 }, limit: 12, projection }).toArray();
    const starts = closed.length ? await activities.find({ workspaceId, "event.type": "sprint.started", "event.entityId": { $in: closed.map((s) => s._id) } }, { session, projection: { "event.entityId": 1, "event.changes.reporting.after": 1 } }).toArray() : [];
    const trend: TrendRow[] = closed.map((s) => {
      const start = starts.find((row) => row.event?.entityId === s._id)?.event?.changes?.reporting?.after;
      const tasks = s.outcome?.tasks.map((t) => taskMetric({ ...t, sprintId: s._id }));
      return { id: s._id, name: s.name, status: s.status as "completed" | "cancelled", endedAt: s.outcome?.endedAt ?? null, initial: reporting(start) && start.kind === "start" && start.baseline ? totals(start.baseline) : null, final: tasks ? totals(tasks) : null, returned: s.outcome ? measure(s.outcome.tasks.filter((t) => t.returnedToBacklog).map((t) => taskMetric({ ...t, sprintId: s._id }))) : null };
    });
    const changes = [...timeline.changes].sort((a, b) => b.sequence - a.sequence), page = changes.filter((c) => !before || c.sequence < before).slice(0, 51);
    return { ...timeline, asOf, changes: { rows: page.slice(0, 50), total: changes.length, nextBefore: page.length > 50 ? page[49].sequence : null }, trend: { rows: trend, total, limit: 12 } };
  }
}
