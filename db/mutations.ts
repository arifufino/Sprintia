import { createHash } from "node:crypto";
import type { ClientSession } from "mongodb";
import client from "../lib/mongodb";
import { UserFacingError } from "../lib/errors";
import type { AppUser } from "../app/lib/types";
import { canManageAccess, canManageProject } from "../app/lib/permissions";
import { database, isMember, createTask, updateTask, deleteTask, reorderBacklog, createSprint, updateSprint, startSprint, closeSprint, cancelSprint, changeImpediment, addTaskComment, saveDailyNote, createWorkspace, joinWorkspace, updateScrumConfiguration, updateMemberAccess, manageInvitation } from "./runtime";
import type { MutationContext } from "./mutation-context";
import { saveSprintReview, addReviewEntry, convertReviewDecision } from "./review";
import { addRetroObservation, selectRetroProblem, createRetroAction, updateRetroAction } from "./retro";

type Result = { ok: true; workspaceId?: string; sprintId?: string; taskId?: string; retroActionId?: string };
type Receipt = { _id: string; actorId: string; workspaceId: string; action: string; fingerprint: string; result: Result; createdAt: string };
const actions = { createTask, updateTask, deleteTask, reorderBacklog, createSprint, updateSprint, startSprint, closeSprint, cancelSprint, changeImpediment, addTaskComment, saveDailyNote, saveSprintReview, addReviewEntry, convertReviewDecision, addRetroObservation, selectRetroProblem, createRetroAction, updateRetroAction, createWorkspace, joinWorkspace, updateScrumConfiguration, updateMemberAccess, manageInvitation };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  return JSON.stringify(value);
}

export async function executeMutation(user: AppUser, body: Record<string, unknown>): Promise<Result> {
  if (typeof body.action !== "string" || !Object.hasOwn(actions, body.action)) throw new UserFacingError("Acción no válida.");
  if (typeof body.mutationId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.mutationId)) {
    throw new UserFacingError("Falta un identificador válido del cambio. Actualiza Sprintia antes de guardar.");
  }
  const action = body.action as keyof typeof actions;
  const operationId = `${user.id}:${body.mutationId}`;
  const { mutationId: _ignored, ...input } = body;
  void _ignored;
  const fingerprint = createHash("sha256").update(canonical(input)).digest("hex");
  const db = await database(); // Prepare collections/indexes OUTSIDE the transaction.
  const receipts = db.collection<Receipt>("mutation_receipts");
  const replay = async (receipt: Receipt, session: ClientSession) => {
    if (receipt.fingerprint !== fingerprint) throw new UserFacingError("Ese identificador ya se usó para otro cambio. No se ha aplicado la nueva solicitud.", 409);
    const role = await isMember(receipt.workspaceId, user.id, session);
    const allowed = action === "updateMemberAccess" ? canManageAccess(role)
      : ["manageInvitation", "updateScrumConfiguration", "cancelSprint"].includes(action) ? canManageProject(role) : !!role;
    if (!allowed) throw new UserFacingError("Ya no tienes permiso para consultar este cambio.", 403);
    return receipt.result;
  };
  try {
    return await client.withSession(async (session) => session.withTransaction(async () => {
      const previous = await receipts.findOne({ _id: operationId }, { session });
      if (previous) return replay(previous, session);
      const context: MutationContext = { session, operationId };
      const id = await actions[action](user, body, context);
      const result: Result = { ok: true };
      if (action === "createWorkspace" || action === "joinWorkspace") result.workspaceId = id as string;
      if (action === "createSprint") result.sprintId = id as string;
      if (action === "createRetroAction") result.retroActionId = id as string;
      if (action === "createTask" || action === "convertReviewDecision") result.taskId = id as string;
      await receipts.insertOne({
        _id: operationId, actorId: user.id, action, fingerprint, result,
        workspaceId: result.workspaceId ?? String(body.workspaceId), createdAt: new Date().toISOString(),
      }, { session });
      return result;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", maxCommitTimeMS: 10_000, timeoutMS: 20_000 }));
  } catch (error) {
    const code = (error as { code?: number }).code;
    // A concurrent duplicate can lose on the unique receipt/event index. Its whole
    // transaction was aborted; only a matching committed receipt can acknowledge it.
    if (code === 11000) {
      const previous = await receipts.findOne({ _id: operationId });
      if (previous) return client.withSession((session) => replay(previous, session));
    }
    if (code === 20) throw new UserFacingError("La base necesita un replica set para guardar de forma segura. No se aplicó el cambio.", 503);
    throw error;
  }
}
