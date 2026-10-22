import type { ClientSession, Db } from "mongodb";
import type { AppUser, ReviewEntry, ReviewEvidence, ReviewIncrement, ReviewSource, ReviewTask, Sprint, SprintReview } from "../app/lib/types";
import { UserFacingError } from "../lib/errors";
import { revisionFilter, type MutationContext } from "./mutation-context";
import { createTask, database, isMember, WorkspaceUnavailableError } from "./runtime";

type ReviewDocument = { _id: string; workspaceId: string; sprintId: string; revision: number; increment: ReviewIncrement };
type EntryDocument = Omit<ReviewEntry, "id"> & { _id: string; workspaceId: string; sprintId: string };
type SprintDocument = Omit<Sprint, "id" | "revision"> & { _id: string; revision?: number };
const stores = (db: Db) => ({ reviews: db.collection<ReviewDocument>("sprint_reviews"), entries: db.collection<EntryDocument>("review_entries"), sprints: db.collection<SprintDocument>("sprints") });
const id = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : "";
function text(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || value.length > max) throw new UserFacingError(`${label}: máximo ${max} caracteres.`);
  return value.trim();
}
function version(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new UserFacingError("La versión no es válida. Revisa los datos antes de guardar.");
  return value;
}
function evidence(value: unknown): ReviewEvidence[] {
  if (!Array.isArray(value) || value.length > 10) throw new UserFacingError("Añade como máximo 10 evidencias.");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new UserFacingError("La evidencia no es válida.");
    const label = text(item.label, 100, "Nombre de evidencia"), url = text(item.url, 2048, "Enlace");
    try { const parsed = new URL(url); if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
    catch { throw new UserFacingError("Las evidencias necesitan un enlace http o https, sin credenciales."); }
    if (!label) throw new UserFacingError("Pon un nombre a cada evidencia.");
    return { label, url };
  });
}
async function scope(user: AppUser, payload: Record<string, unknown>, session: ClientSession) {
  const workspaceId = id(payload.workspaceId), sprintId = id(payload.sprintId);
  if (!workspaceId || !sprintId) throw new UserFacingError("Selecciona un proyecto y sprint válidos.");
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.", 403);
  const db = await database(), store = stores(db);
  const sprint = await store.sprints.findOne({ _id: sprintId, workspaceId }, { session });
  if (!sprint) throw new UserFacingError("No encontramos ese sprint.");
  if (!["active", "completed"].includes(sprint.status)) throw new UserFacingError("La Review se registra en un sprint activo o completado. Los planes y cancelados son de consulta.", 409);
  return { db, store, workspaceId, sprintId, sprint };
}
async function touch(store: ReturnType<typeof stores>, workspaceId: string, sprintId: string, session: ClientSession) {
  const result = await store.sprints.updateOne({ _id: sprintId, workspaceId, status: { $in: ["active", "completed"] } }, { $inc: { reviewRevision: 1 } }, { session });
  if (!result.matchedCount) throw new UserFacingError("El sprint cambió. Revisa su estado.", 409);
}
async function audit(db: Db, context: MutationContext, user: AppUser, workspaceId: string, sprintId: string, type: string, revision: number, before: unknown, after: unknown) {
  await db.collection("activities").insertOne({ _id: `event_${crypto.randomUUID()}` as never, workspaceId, userId: user.id, actorName: user.name, message: type === "review.increment.saved" ? "registró el incremento y sus evidencias" : "añadió feedback o una decisión en la Review", createdAt: new Date().toISOString(), event: { type, entityId: sprintId, entityRevision: revision, operationId: context.operationId, changes: { review: { before, after } } } }, { session: context.session });
}

export async function getSprintReview(user: AppUser, workspaceId: string, sprintId: string, before?: string | null, entryId?: string | null): Promise<SprintReview> {
  const store = stores(await database());
  if (!(await isMember(workspaceId, user.id)) || !(await store.sprints.findOne({ _id: sprintId, workspaceId }))) throw new WorkspaceUnavailableError();
  const current = await store.reviews.findOne({ workspaceId, sprintId });
  if (entryId) {
    const row = await store.entries.findOne({ _id: entryId, workspaceId, sprintId });
    if (!row) throw new WorkspaceUnavailableError();
    const { _id, workspaceId: _w, sprintId: _s, ...entry } = row; void _w; void _s;
    return { revision: current?.revision ?? 0, increment: current?.increment ?? null, entries: [{ id: _id, ...entry }], nextCursor: null };
  }
  const cursor = before ? await store.entries.findOne({ _id: before, workspaceId, sprintId }) : null;
  if (before && !cursor) throw new UserFacingError("La página de Review no es válida. Actualiza los comentarios.");
  const rows = await store.entries.find({ workspaceId, sprintId, ...(cursor ? { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }] } : {}) }).sort({ createdAt: -1, _id: -1 }).limit(51).toArray();
  const page = rows.slice(0, 50);
  return { revision: current?.revision ?? 0, increment: current?.increment ?? null, entries: page.reverse().map(({ _id, workspaceId: _w, sprintId: _s, ...entry }) => { void _w; void _s; return { id: _id, ...entry }; }), nextCursor: rows.length > 50 ? rows[49]._id : null };
}

export async function saveSprintReview(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const { db, store, workspaceId, sprintId, sprint } = await scope(user, payload, session);
  const expected = version(payload.revision), sprintRevision = version(payload.sprintRevision);
  if ((sprint.revision ?? 0) !== sprintRevision) throw new UserFacingError("El sprint o su trabajo cambió. Tu borrador se conserva; revisa las tareas antes de guardar.", 409);
  if (payload.verified !== true) throw new UserFacingError("Confirma con el equipo la Definition of Done del trabajo seleccionado.");
  const summary = text(payload.summary, 2000, "Resultado");
  if (!summary) throw new UserFacingError("Describe el resultado conseguido.");
  const links = evidence(payload.evidence);
  if (!Array.isArray(payload.taskIds) || payload.taskIds.length > 200 || payload.taskIds.some((taskId) => !id(taskId)) || new Set(payload.taskIds).size !== payload.taskIds.length) throw new UserFacingError("Selecciona hasta 200 tareas sin repetir.");
  const current = await store.reviews.findOne({ workspaceId, sprintId }, { session });
  if ((current?.revision ?? 0) !== expected) throw new UserFacingError("Otra sesión actualizó el incremento. Conservamos tu borrador; revisa la versión actual.", 409);
  let definitionOfDone: string[], productGoal: string, candidates: ReviewTask[];
  if (sprint.status === "completed") {
    if (!sprint.outcome) throw new UserFacingError("Este sprint antiguo no tiene una instantánea de cierre. No podemos certificar trabajo histórico que no se conservó.", 409);
    definitionOfDone = sprint.outcome.definitionOfDone; productGoal = sprint.outcome.productGoal;
    candidates = sprint.outcome.tasks.filter((task) => task.status === "done" && !task.returnedToBacklog && !task.impediment);
  } else {
    // Shares the project document with governance edits, preventing a stale DoD
    // from being certified while another transaction changes the agreements.
    await db.collection("workspaces").updateOne({ _id: workspaceId as never }, { $inc: { reviewSnapshotRevision: 1 } }, { session });
    const workspace = await db.collection("workspaces").findOne({ _id: workspaceId as never }, { session });
    if ((workspace?.governanceRevision ?? 0) !== version(payload.governanceRevision)) throw new UserFacingError("La Definition of Done cambió. Revisa los acuerdos antes de confirmar.", 409);
    definitionOfDone = workspace?.definitionOfDone ?? []; productGoal = workspace?.productGoal ?? "";
    const rows = await db.collection("tasks").find({ workspaceId, sprintId, status: "done", impediment: null }, { session }).sort({ sortOrder: 1, _id: 1 }).toArray();
    candidates = rows.map((task) => ({ id: String(task._id), revision: task.revision ?? 0, code: task.code, title: task.title, description: task.description, acceptanceCriteria: task.acceptanceCriteria ?? [], checklist: task.checklist ?? [], points: task.points ?? null }));
  }
  const selected = payload.taskIds as string[];
  if (selected.some((taskId) => !candidates.some((task) => task.id === taskId))) throw new UserFacingError("Solo incluye trabajo terminado y sin bloqueos del sprint seleccionado.", 409);
  // Explicit confirmation can also record an honest outcome without an increment.
  const tasks = candidates.filter((task) => selected.includes(task.id)).map((task) => ({ id: task.id, revision: task.revision, code: task.code, title: task.title, description: task.description, acceptanceCriteria: task.acceptanceCriteria, checklist: task.checklist, points: task.points }));
  if (tasks.length && !definitionOfDone.length) throw new UserFacingError("Define primero la Definition of Done. Sin esos acuerdos no se certifica trabajo como incremento.", 409);
  const increment: ReviewIncrement = { summary, evidence: links, tasks, definitionOfDone: [...definitionOfDone], productGoal, sprintGoal: sprint.goal, recordedAt: new Date().toISOString(), actorId: user.id, actorName: user.name, sourceStatus: sprint.status as "active" | "completed" };
  await touch(store, workspaceId, sprintId, session);
  if (current) {
    const changed = await store.reviews.updateOne({ _id: current._id, ...revisionFilter(expected) }, { $set: { increment }, $inc: { revision: 1 } }, { session });
    if (!changed.matchedCount) throw new UserFacingError("La Review cambió. Revisa el incremento.", 409);
  } else await store.reviews.insertOne({ _id: `review_${crypto.randomUUID()}`, workspaceId, sprintId, revision: 1, increment }, { session });
  // Keep complete versions outside the bootstrap activity feed, which is loaded
  // on every refresh. Large task snapshots must not be repeated there.
  await db.collection("review_revisions").insertOne({ _id: `reviewversion_${crypto.randomUUID()}` as never, workspaceId, sprintId, revision: expected + 1, increment }, { session });
  await audit(db, context, user, workspaceId, sprintId, "review.increment.saved", expected + 1, { revision: expected }, { revision: expected + 1, taskCount: tasks.length, evidenceCount: links.length });
}

export async function addReviewEntry(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { db, store, workspaceId, sprintId } = await scope(user, payload, context.session);
  if (payload.kind !== "feedback" && payload.kind !== "decision") throw new UserFacingError("Elige feedback o decisión.");
  const entryText = text(payload.text, 2000, "Comentario"); if (!entryText) throw new UserFacingError("Escribe feedback o una decisión.");
  const entry: EntryDocument = { _id: `reviewentry_${crypto.randomUUID()}`, workspaceId, sprintId, kind: payload.kind, text: entryText, actorId: user.id, actorName: user.name, createdAt: new Date().toISOString(), backlogTask: null };
  await touch(store, workspaceId, sprintId, context.session);
  await store.entries.insertOne(entry, { session: context.session });
  await audit(db, context, user, workspaceId, sprintId, "review.entry.added", 0, null, { id: entry._id, kind: entry.kind, text: entry.text });
}

export async function convertReviewDecision(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { db, store, workspaceId, sprintId, sprint } = await scope(user, payload, context.session);
  const entry = await store.entries.findOne({ _id: id(payload.entryId), workspaceId, sprintId, kind: "decision" }, { session: context.session });
  if (!entry) throw new UserFacingError("No encontramos esa decisión en la Review.");
  if (entry.backlogTask) return entry.backlogTask.id;
  const title = text(payload.title, 160, "Título"), description = text(payload.description, 1200, "Descripción");
  if (!title) throw new UserFacingError("Escribe un título para el elemento del backlog.");
  await touch(store, workspaceId, sprintId, context.session);
  const taskId = await createTask(user, { workspaceId, title, description, status: "backlog", points: null, assigneeId: null }, context);
  const source: ReviewSource = { sprintId, sprintName: sprint.name, entryId: entry._id };
  const task = await db.collection("tasks").findOneAndUpdate({ _id: taskId as never, workspaceId }, { $set: { reviewSource: source } }, { returnDocument: "after", session: context.session });
  if (!task) throw new Error("Missing converted task");
  await store.entries.updateOne({ _id: entry._id, workspaceId, sprintId }, { $set: { backlogTask: { id: taskId, code: task.code, title } } }, { session: context.session });
  // Reuse createTask's one atomic audit event; no duplicate operation index.
  await db.collection("activities").updateOne({ "event.operationId": context.operationId }, { $set: { "event.type": "review.decision.converted", "event.changes.reviewSource": { before: null, after: source } } }, { session: context.session });
  return taskId;
}
