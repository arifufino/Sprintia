import type { Document } from "mongodb";
import client, { appDatabase } from "../lib/mongodb";
import type { AppUser } from "../app/lib/types";
import { canManageProject } from "../app/lib/permissions";
import { UserFacingError } from "../lib/errors";
import { WorkspaceUnavailableError } from "./runtime";

// Explicit public fields: an export is portable project content, NOT a DB backup.
type Shape = { [key: string]: true | Shape | [Shape] };
const checklist = { id: true, text: true, done: true } as const;
const impediment = { id: true, reason: true, ownerId: true, ownerName: true, createdAt: true, createdById: true, createdByName: true, updatedAt: true } as const;
const task: Shape = { _id: true, workspaceId: true, sprintId: true, code: true, title: true, description: true, acceptanceCriteria: true, checklist: [checklist], status: true, priority: true, points: true, assigneeId: true, reporterId: true, sortOrder: true, createdAt: true, updatedAt: true, impediment, reviewSource: { sprintId: true, sprintName: true, entryId: true } };
const outcomeTask: Shape = { ...task, id: true, returnedToBacklog: true, assigneeName: true };
const plan: Shape = { name: true, goal: true, startDate: true, endDate: true, startedAt: true, availability: true, capacityHours: true };
const increment: Shape = { summary: true, evidence: [{ label: true, url: true }], tasks: [outcomeTask], definitionOfDone: true, productGoal: true, sprintGoal: true, recordedAt: true, actorId: true, actorName: true, sourceStatus: true };
const fields: Record<string, { limit: number; shape: Shape }> = {
  sprints: { limit: 500, shape: { _id: true, ...plan, status: true, outcome: { kind: true, endedAt: true, actorId: true, actorName: true, summary: true, reason: true, plan, productGoal: true, definitionOfDone: true, tasks: [outcomeTask] } } },
  tasks: { limit: 5000, shape: task },
  task_updates: { limit: 5000, shape: { _id: true, taskId: true, kind: true, text: true, actorId: true, actorName: true, createdAt: true, before: impediment, after: impediment } },
  daily_notes: { limit: 1000, shape: { _id: true, sprintId: true, date: true, text: true, updatedAt: true, updatedById: true, updatedByName: true } },
  sprint_reviews: { limit: 500, shape: { _id: true, sprintId: true, increment } },
  review_entries: { limit: 5000, shape: { _id: true, sprintId: true, kind: true, text: true, actorId: true, actorName: true, createdAt: true, backlogTask: { id: true, code: true, title: true } } },
  retro_observations: { limit: 5000, shape: { _id: true, sprintId: true, kind: true, text: true, selected: true, actionId: true, actorId: true, actorName: true, createdAt: true } },
  retro_actions: { limit: 5000, shape: { _id: true, sprintId: true, sprintName: true, observationId: true, observation: true, title: true, measure: true, ownerId: true, ownerName: true, targetSprintId: true, targetSprintName: true, status: true, note: true, createdAt: true, updatedAt: true } },
};
function select(row: Document, shape: Shape): Document {
  return Object.fromEntries(Object.entries(shape).filter(([key]) => Object.hasOwn(row, key)).map(([key, kind]) => {
    const value = row[key];
    if (kind === true) return [key === "_id" ? "id" : key, value];
    return [key, value == null ? null : Array.isArray(kind) ? (Array.isArray(value) ? value.map((item: Document) => select(item, kind[0])) : []) : select(value, kind)];
  }));
}
export async function exportProject(user: AppUser, workspaceId: string) {
  const db = await appDatabase();
  return client.withSession((session) => session.withTransaction(async () => {
    const membership = await db.collection("memberships").findOne({ workspaceId, userId: user.id }, { session });
    const workspace = await db.collection("workspaces").findOne({ _id: workspaceId as never }, { session });
    if (!membership || !workspace) throw new WorkspaceUnavailableError();
    if (!canManageProject(membership.role)) throw new UserFacingError("Solo el propietario o un administrador puede exportar el proyecto.", 403);
    const content: Record<string, Document[]> = {};
    for (const [name, { limit, shape }] of Object.entries(fields)) {
      const rows = await db.collection(name).find({ workspaceId }, { session, projection: Object.fromEntries(Object.keys(shape).map((key) => [key, 1])), maxTimeMS: 8000 }).sort({ _id: 1 }).limit(limit + 1).toArray();
      if (rows.length > limit) throw new UserFacingError("Este proyecto supera el límite de exportación web. Solicita una copia operativa completa; no se ha descargado un archivo parcial.", 503);
      content[name] = rows.map((row) => select(row, shape));
    }
    const members = await db.collection("memberships").find({ workspaceId }, { session, maxTimeMS: 8000 }).limit(201).toArray();
    if (members.length > 200) throw new UserFacingError("El equipo supera el límite de exportación web. Solicita una copia operativa.", 503);
    const profiles = await db.collection("profiles").find({ _id: { $in: members.map((m) => m.userId) } }, { session, projection: { _id: 1, name: 1 }, maxTimeMS: 8000 }).toArray();
    const result = {
      format: "sprintia-project", version: 1, exportedAt: new Date().toISOString(),
      notice: "Contenido privado del equipo. No contiene credenciales ni correos de perfil. No es una copia restaurable de la base de datos: no incluye auditoría, recibos ni todas las revisiones históricas.",
      workspace: select(workspace, { _id: true, name: true, productGoal: true, definitionOfDone: true, productOwnerId: true, scrumMasterId: true, developerIds: true }),
      members: members.map((m) => ({ id: m.userId, name: profiles.find((p) => p._id === m.userId)?.name ?? "Integrante", role: m.role })),
      ...content,
    };
    const json = JSON.stringify(result, null, 2);
    if (Buffer.byteLength(json) > 4 * 1024 * 1024) throw new UserFacingError("El archivo supera 4 MB. Solicita una copia operativa; no se ha descargado un archivo parcial.", 503);
    return json;
  }, { readConcern: { level: "snapshot" }, readPreference: "primary", maxCommitTimeMS: 10_000 }));
}
