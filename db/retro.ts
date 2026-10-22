import type { ClientSession, Db, Filter } from "mongodb";
import type { AppUser, RetroAction, RetroActionDetail, RetroActionState, RetroObservation, RetroUpdate, SprintRetro } from "../app/lib/types";
import { UserFacingError } from "../lib/errors";
import type { MutationContext } from "./mutation-context";
import { database, isMember, WorkspaceUnavailableError } from "./runtime";

type ObservationDoc = Omit<RetroObservation, "id"> & { _id: string; workspaceId: string; sprintId: string };
type ActionDoc = Omit<RetroAction, "id"> & { _id: string; workspaceId: string };
type UpdateDoc = Omit<RetroUpdate, "id"> & { _id: string; workspaceId: string; actionId: string };
const stores = (db: Db) => ({ observations: db.collection<ObservationDoc>("retro_observations"), actions: db.collection<ActionDoc>("retro_actions"), updates: db.collection<UpdateDoc>("retro_updates") });
const id = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v) ? v : "";
const publicAction = ({ _id, workspaceId: _w, ...row }: ActionDoc): RetroAction => { void _w; return { id: _id, ...row }; };
const stateOf = (a: RetroActionState): RetroActionState => ({ title: a.title, measure: a.measure, ownerId: a.ownerId, ownerName: a.ownerName, targetSprintId: a.targetSprintId, targetSprintName: a.targetSprintName, status: a.status });
function text(v: unknown, max: number, label: string) {
  if (typeof v !== "string" || v.length > max || !v.trim()) throw new UserFacingError(`${label}: escribe entre 1 y ${max} caracteres.`);
  return v.trim();
}
function version(v: unknown) { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new UserFacingError("Revisa la versión del acuerdo antes de guardar."); return v; }
async function scope(user: AppUser, payload: Record<string, unknown>, session: ClientSession, newAgreement = true) {
  const workspaceId = id(payload.workspaceId), sprintId = id(payload.sprintId);
  if (!workspaceId || !sprintId) throw new UserFacingError("Selecciona un proyecto y sprint válidos.");
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.", 403);
  const db = await database(), store = stores(db);
  const sprint = await db.collection("sprints").findOne({ _id: sprintId as never, workspaceId }, { session });
  if (!sprint) throw new UserFacingError("No encontramos ese sprint.");
  if (newAgreement) {
    // Serializes selection/count limits with closure and concurrent additions.
    const changed = await db.collection("sprints").updateOne({ _id: sprintId as never, workspaceId, status: { $in: ["active", "completed"] } }, { $inc: { retroRevision: 1 } }, { session });
    if (!changed.matchedCount) throw new UserFacingError("Registra observaciones y acuerdos en un sprint activo o completado. Los planes y cancelados son de consulta.", 409);
  }
  // Refresh follow-up across sprints without changing their content versions.
  await db.collection("workspaces").updateOne({ _id: workspaceId as never }, { $inc: { retroRevision: 1 } }, { session });
  return { db, store, workspaceId, sprintId, sprint };
}
async function actionState(db: Db, workspaceId: string, payload: Record<string, unknown>, session: ClientSession, previous?: ActionDoc): Promise<RetroActionState> {
  const title = text(payload.title, 160, "Acción"), measure = text(payload.measure, 1000, "Cómo comprobaremos la mejora");
  const ownerId = id(payload.ownerId);
  if (!ownerId || !(await isMember(workspaceId, ownerId, session))) throw new UserFacingError("El responsable debe pertenecer al proyecto.");
  const profile = await db.collection("profiles").findOne({ _id: ownerId as never }, { session });
  if (!profile) throw new UserFacingError("No encontramos a ese integrante.");
  if (payload.targetSprintId !== null && !id(payload.targetSprintId)) throw new UserFacingError("Elige un sprint de seguimiento o Sin fecha.");
  const targetSprintId = payload.targetSprintId as string | null;
  const target = targetSprintId ? await db.collection("sprints").findOne({ _id: targetSprintId as never, workspaceId }, { session }) : null;
  if (targetSprintId && (!target || (!["planned", "active"].includes(target.status) && targetSprintId !== previous?.targetSprintId))) throw new UserFacingError("El seguimiento necesita un sprint planificado o activo del mismo proyecto.");
  if (!["open", "progress", "done", "dropped"].includes(String(payload.status))) throw new UserFacingError("El estado de la mejora no es válido.");
  return { title, measure, ownerId, ownerName: profile.name, targetSprintId, targetSprintName: target?.name ?? null, status: payload.status as RetroActionState["status"] };
}
async function audit(db: Db, user: AppUser, workspaceId: string, entityId: string, revision: number, type: string, before: unknown, after: unknown, context: MutationContext) {
  await db.collection("activities").insertOne({ _id: `event_${crypto.randomUUID()}` as never, workspaceId, userId: user.id, actorName: user.name, message: "actualizó la retrospectiva y sus mejoras", createdAt: new Date().toISOString(), event: { type, entityId, entityRevision: revision, operationId: context.operationId, changes: { retro: { before, after } } } }, { session: context.session });
}
async function recordUpdate(db: Db, user: AppUser, action: ActionDoc, note: string, context: MutationContext) {
  await stores(db).updates.insertOne({ _id: `retroupdate_${crypto.randomUUID()}`, workspaceId: action.workspaceId, actionId: action._id, revision: action.revision, actorId: user.id, actorName: user.name, createdAt: action.updatedAt, note, state: stateOf(action) }, { session: context.session });
}

export async function addRetroObservation(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { db, store, workspaceId, sprintId } = await scope(user, payload, context.session);
  if (!["keep", "problem", "idea"].includes(String(payload.kind))) throw new UserFacingError("Elige conservar, problema o idea.");
  const body = text(payload.text, 1000, "Observación");
  if (await store.observations.countDocuments({ workspaceId, sprintId }, { session: context.session }) >= 100) throw new UserFacingError("Esta retrospectiva ya tiene 100 observaciones. Concreta las mejoras a partir de las existentes.");
  const row: ObservationDoc = { _id: `retroobs_${crypto.randomUUID()}`, workspaceId, sprintId, revision: 0, kind: payload.kind as RetroObservation["kind"], text: body, selected: false, actionId: null, actorId: user.id, actorName: user.name, createdAt: new Date().toISOString() };
  await store.observations.insertOne(row, { session: context.session });
  await audit(db, user, workspaceId, row._id, 0, "retro.observation.added", null, { sprintId, kind: row.kind, text: body }, context);
}
export async function selectRetroProblem(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { db, store, workspaceId, sprintId } = await scope(user, payload, context.session);
  const row = await store.observations.findOne({ _id: id(payload.id), workspaceId, sprintId, kind: "problem" }, { session: context.session });
  if (!row) throw new UserFacingError("No encontramos ese problema en esta retrospectiva.");
  if (row.revision !== version(payload.revision)) throw new UserFacingError("Otra sesión cambió la selección. Actualiza la retrospectiva antes de decidir.", 409);
  if (typeof payload.selected !== "boolean") throw new UserFacingError("La selección no es válida.");
  if (row.actionId && !payload.selected) throw new UserFacingError("Este problema ya tiene una acción. Conserva su origen y actualiza el seguimiento.", 409);
  await store.observations.updateOne({ _id: row._id, revision: row.revision }, { $set: { selected: payload.selected }, $inc: { revision: 1 } }, { session: context.session });
  await audit(db, user, workspaceId, row._id, row.revision + 1, "retro.problem.selected", { selected: row.selected }, { selected: payload.selected }, context);
}
export async function createRetroAction(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { db, store, workspaceId, sprintId, sprint } = await scope(user, payload, context.session);
  const row = await store.observations.findOne({ _id: id(payload.observationId), workspaceId, sprintId, kind: "problem" }, { session: context.session });
  if (!row) throw new UserFacingError("Selecciona un problema de esta retrospectiva.");
  const previous = await store.actions.findOne({ workspaceId, observationId: row._id }, { session: context.session });
  if (previous) return previous._id; // One agreement per problem across users/new keys.
  if (!row.selected || row.revision !== version(payload.observationRevision)) throw new UserFacingError("La selección del problema cambió. Revisa la retrospectiva; conservamos tu propuesta.", 409);
  if (await store.actions.countDocuments({ workspaceId, sprintId }, { session: context.session }) >= 50) throw new UserFacingError("Ya hay 50 acuerdos en este sprint. Da seguimiento a los existentes antes de añadir más.");
  const state = await actionState(db, workspaceId, { ...payload, status: "open" }, context.session);
  const now = new Date().toISOString();
  const action: ActionDoc = { _id: `retroaction_${crypto.randomUUID()}`, workspaceId, sprintId, sprintName: sprint.name, observationId: row._id, observation: row.text, ...state, revision: 0, createdAt: now, createdById: user.id, createdByName: user.name, updatedAt: now, updatedByName: user.name, note: "Acuerdo registrado." };
  await store.actions.insertOne(action, { session: context.session });
  await store.observations.updateOne({ _id: row._id, revision: row.revision }, { $set: { actionId: action._id }, $inc: { revision: 1 } }, { session: context.session });
  await recordUpdate(db, user, action, action.note, context);
  await audit(db, user, workspaceId, action._id, 0, "retro.action.created", null, { sprintId, observationId: row._id, ...state }, context);
  return action._id;
}
export async function updateRetroAction(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { db, store, workspaceId } = await scope(user, payload, context.session, false);
  const previous = await store.actions.findOne({ _id: id(payload.id), workspaceId }, { session: context.session });
  if (!previous) throw new UserFacingError("No encontramos esa mejora en el proyecto.");
  if (previous.revision !== version(payload.revision)) throw new UserFacingError("Otra sesión actualizó esta mejora. Conservamos tu borrador; compara el seguimiento actual.", 409);
  const next = await actionState(db, workspaceId, payload, context.session, previous), note = text(payload.note, 1000, "Nota de seguimiento o resultado");
  if (next.status === "done" && payload.verified !== true) throw new UserFacingError("Confirma con el equipo que se comprobó el criterio de la mejora.");
  const action: ActionDoc = { ...previous, ...next, note, updatedAt: new Date().toISOString(), updatedByName: user.name, revision: previous.revision + 1 };
  const saved = await store.actions.replaceOne({ _id: previous._id, workspaceId, revision: previous.revision }, action, { session: context.session });
  if (!saved.matchedCount) throw new UserFacingError("La mejora cambió. Actualiza el seguimiento.", 409);
  await recordUpdate(db, user, action, note, context);
  await audit(db, user, workspaceId, action._id, action.revision, "retro.action.updated", stateOf(previous), { ...next, note }, context);
}

// Authorize before looking up cursors. Missing and foreign resources are identical.
export async function getSprintRetro(user: AppUser, workspaceId: string, sprintId: string, filter: "open" | "origin" | "all", before?: string | null): Promise<SprintRetro> {
  const db = await database(), store = stores(db);
  if (!(await isMember(workspaceId, user.id)) || !(await db.collection("sprints").findOne({ _id: sprintId as never, workspaceId }))) throw new WorkspaceUnavailableError();
  const query: Filter<ActionDoc> = { workspaceId, ...(filter === "open" ? { status: { $in: ["open", "progress"] } } : filter === "origin" ? { sprintId } : {}) };
  const cursor = before ? await store.actions.findOne({ ...query, _id: before }) : null;
  if (before && !cursor) throw new UserFacingError("La página de mejoras cambió. Actualiza la lista.", 409);
  const rows = await store.actions.find({ ...query, ...(cursor ? { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }] } : {}) }).sort({ createdAt: -1, _id: -1 }).limit(51).toArray();
  const observations = await store.observations.find({ workspaceId, sprintId }).sort({ createdAt: 1, _id: 1 }).limit(100).toArray();
  const counts: SprintRetro["counts"] = { open: 0, progress: 0, done: 0, dropped: 0 };
  for (const row of await store.actions.aggregate<{ _id: keyof typeof counts; count: number }>([{ $match: { workspaceId } }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray()) if (Object.hasOwn(counts, row._id)) counts[row._id] = row.count;
  return { observations: observations.map(({ _id, workspaceId: _w, sprintId: _s, ...row }) => { void _w; void _s; return { id: _id, ...row }; }), actions: rows.slice(0, 50).map(publicAction), nextCursor: rows.length > 50 ? rows[49]._id : null, counts };
}
export async function getRetroAction(user: AppUser, workspaceId: string, sprintId: string, actionId: string, before?: string | null): Promise<RetroActionDetail> {
  const db = await database(), store = stores(db);
  if (!(await isMember(workspaceId, user.id)) || !(await db.collection("sprints").findOne({ _id: sprintId as never, workspaceId }))) throw new WorkspaceUnavailableError();
  const action = await store.actions.findOne({ _id: actionId, workspaceId });
  if (!action) throw new WorkspaceUnavailableError();
  const cursor = before ? await store.updates.findOne({ _id: before, workspaceId, actionId }) : null;
  if (before && !cursor) throw new UserFacingError("La página del seguimiento no es válida.");
  const rows = await store.updates.find({ workspaceId, actionId, ...(cursor ? { revision: { $lt: cursor.revision } } : {}) }).sort({ revision: -1 }).limit(51).toArray();
  return { action: publicAction(action), updates: rows.slice(0, 50).map(({ _id, workspaceId: _w, actionId: _a, ...row }) => { void _w; void _a; return { id: _id, ...row }; }), nextCursor: rows.length > 50 ? rows[49]._id : null };
}
