// Pure report projection. No database, clock, personal metrics or UI dependencies.
export type MetricTask = { id: string; code: string; sprintId: string | null; status: string; points: number | null };
type EventBase = { version: 1; sequence: number; at: string; sprintIds: string[] };
export type ReportEvent = EventBase & ({ kind: "task"; metricBefore: MetricTask | null; metricAfter: MetricTask | null } | { kind: "start"; sprintId: string; baseline: MetricTask[] | null } | { kind: "end"; sprintId: string });
export type Measure = { tasks: number; points: number; unestimated: number };
export type Totals = { scope: Measure; pending: Measure; done: Measure };
export type ReportChange = { sequence: number; at: string; code: string; kinds: ("added" | "removed" | "completed" | "reopened" | "estimate" | "status")[]; beforePoints: number | null; afterPoints: number | null; beforeStatus: string | null; afterStatus: string | null; deleted: boolean };
export type Timeline = { coverage: "complete" | "partial" | "none" | "limit" | "planned"; reason: string; initial: Totals | null; initialAt: string | null; current: Totals | null; samples: { at: string; totals: Totals }[]; intervalDays: number; changes: ReportChange[]; deltas: { added: Measure; removed: Measure; reestimated: number; knownPointsDelta: number; reopened: number } };
export type TrendRow = { id: string; name: string; status: "completed" | "cancelled"; endedAt: string | null; initial: Totals | null; final: Totals | null; returned: Measure | null };
export type SprintReport = Omit<Timeline, "changes"> & { asOf: string; changes: { rows: ReportChange[]; nextBefore: number | null; total: number }; trend: { rows: TrendRow[]; total: number; limit: number } };
export const emptyMeasure = (): Measure => ({ tasks: 0, points: 0, unestimated: 0 });
export const measure = (tasks: MetricTask[]): Measure => ({ tasks: tasks.length, points: tasks.reduce((sum, t) => sum + (t.points ?? 0), 0), unestimated: tasks.filter((t) => t.points === null).length });
export const totals = (tasks: MetricTask[]): Totals => ({ scope: measure(tasks), done: measure(tasks.filter((t) => t.status === "done")), pending: measure(tasks.filter((t) => t.status !== "done")) });
export const taskMetric = (task: { id?: string; _id?: string; code: string; sprintId: string | null; status: string; points?: number | null }): MetricTask => ({ id: task.id ?? task._id!, code: task.code, sprintId: task.sprintId, status: task.status, points: task.points ?? null });
const inSprint = (t: MetricTask | null, sprintId: string) => !!t && t.sprintId === sprintId && t.status !== "backlog";
const sameTask = (a: MetricTask | undefined, b: MetricTask | null) => !!a && !!b && a.id === b.id && a.sprintId === b.sprintId && a.status === b.status && a.points === b.points;
const sameState = (a: Map<string, MetricTask>, b: MetricTask[]) => a.size === b.length && b.every((t) => sameTask(a.get(t.id), t));
const addMeasure = (a: Measure, task: MetricTask) => { a.tasks++; a.points += task.points ?? 0; if (task.points === null) a.unestimated++; };
export function buildTimeline({ sprintId, status, baseline, events, finalTasks, asOf, limited = false, untracked = false }: { sprintId: string; status: string; baseline: Extract<ReportEvent, { kind: "start" }> | null; events: ReportEvent[]; finalTasks: MetricTask[]; asOf: string; limited?: boolean; untracked?: boolean }): Timeline {
  const current = totals(finalTasks), state = new Map((baseline?.baseline ?? []).map((t) => [t.id, t]));
  const initial = baseline?.baseline ? totals(baseline.baseline) : null;
  const changes: ReportChange[] = [], snapshots: { at: string; totals: Totals }[] = [];
  const deltas = { added: emptyMeasure(), removed: emptyMeasure(), reestimated: 0, knownPointsDelta: 0, reopened: 0 };
  let consistent = !untracked && (!baseline || baseline.at <= asOf);
  const relevant = [...events].sort((a, b) => a.sequence - b.sequence);
  let previousSequence = baseline?.sequence ?? -1, previousAt = baseline?.at ?? "";
  if (initial) snapshots.push({ at: baseline!.at, totals: initial });
  for (const event of relevant) {
    if (event.kind !== "task" || (baseline && event.sequence <= baseline.sequence)) continue;
    if (event.sequence <= previousSequence || event.at < previousAt || event.at > asOf) consistent = false;
    previousSequence = event.sequence; previousAt = event.at;
    const before = event.metricBefore, after = event.metricAfter;
    const was = inSprint(before, sprintId), now = inSprint(after, sprintId);
    if (!was && !now) continue;
    const task = after ?? before!;
    if (initial && (was ? !sameTask(state.get(before!.id), before) : state.has(task.id))) consistent = false;
    const kinds: ReportChange["kinds"] = [];
    if (!was && now) { kinds.push("added"); addMeasure(deltas.added, after!); }
    if (was && !now) { kinds.push("removed"); addMeasure(deltas.removed, before!); }
    if (was && now && before!.status !== "done" && after!.status === "done") kinds.push("completed");
    if (was && now && before!.status === "done" && after!.status !== "done") { kinds.push("reopened"); deltas.reopened++; }
    if (was && now && before!.points !== after!.points) { kinds.push("estimate"); deltas.reestimated++; deltas.knownPointsDelta += (after!.points ?? 0) - (before!.points ?? 0); }
    if (!kinds.length && before?.status !== after?.status) kinds.push("status");
    if (kinds.length) changes.push({ sequence: event.sequence, at: event.at, code: task.code, kinds, beforePoints: before?.points ?? null, afterPoints: after?.points ?? null, beforeStatus: before?.status ?? null, afterStatus: after?.status ?? null, deleted: !after });
    if (now) state.set(task.id, after!); else state.delete(task.id);
    if (initial) snapshots.push({ at: event.at, totals: totals([...state.values()]) });
  }
  if (initial && !sameState(state, finalTasks)) consistent = false;
  const coverage: Timeline["coverage"] = status === "planned" ? "planned" : limited ? "limit" : !initial ? "none" : consistent ? "complete" : "partial";
  const reason = coverage === "planned" ? "El sprint aún no se inició. Se muestra su selección actual, no una evolución de trabajo." : coverage === "limit" ? "El informe supera el límite de 10.000 eventos. No se dibuja una serie truncada como si fuera completa." : coverage === "none" ? "No hay una instantánea medible al inicio. No reconstruimos estimaciones ni evolución anteriores; solo mostramos el estado observado y los cambios medibles disponibles." : coverage === "partial" ? "Faltan cambios medibles o no coinciden con el resultado observado. La serie no se muestra para evitar una historia engañosa." : "Serie desde el inicio registrado. El estado entre eventos se conserva, no se estima ni se predice.";
  const samples: Timeline["samples"] = [];
  let intervalDays = 1;
  if (coverage === "complete") {
    const first = Date.parse(baseline!.at), last = Date.parse(asOf);
    intervalDays = Math.max(1, Math.ceil((last - first) / 86400000 / 180));
    // Bucket ends are midnight in Ecuador (UTC-5). Always retain exact start/end.
    let next = Math.floor((first - 5 * 3600000) / 86400000) * 86400000 + (24 + 5) * 3600000;
    const times = [first]; while (next < last && times.length < 182) { times.push(next); next += intervalDays * 86400000; } if (last !== first || snapshots.length > 1) times.push(last);
    let index = 0;
    for (const [position, time] of times.entries()) { if (position > 0) while (index + 1 < snapshots.length && Date.parse(snapshots[index + 1].at) <= time) index++; samples.push({ at: new Date(time).toISOString(), totals: position === 0 ? initial! : snapshots[index].totals }); }
  }
  return { coverage, reason, initial, initialAt: baseline?.at ?? null, current, samples, intervalDays, changes, deltas };
}
