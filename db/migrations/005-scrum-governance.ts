import type { ClientSession, Db, Document } from "mongodb";
import type { ScrumConfiguration } from "../../app/lib/types";

export function governanceDefaults(): ScrumConfiguration & {
  schemaVersion: number; inviteEnabled: boolean; invitationRevision: number;
} {
  return {
    schemaVersion: 5, productGoal: "", definitionOfDone: [], productOwnerId: null,
    scrumMasterId: null, developerIds: [], governanceRevision: 0,
    inviteEnabled: true, invitationRevision: 0,
  };
}

/** Idempotent, additive migration of ONE already-authorized project.
 * Never reassign memberships, infer Scrum responsibilities or rotate existing invitations.
 * The single-document update makes concurrent first visits safe.
 */
export async function migrateScrumGovernance(db: Db, workspaceId: string, session?: ClientSession) {
  const defaults = governanceDefaults();
  const fields = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
    key, key === "schemaVersion" ? 5 : { $cond: [{ $eq: [{ $type: `$${key}` }, "missing"] }, { $literal: value }, `$${key}`] },
  ]));
  await db.collection<Document & { _id: string }>("workspaces").updateOne(
    { _id: workspaceId, $or: [{ schemaVersion: { $exists: false } }, { schemaVersion: { $lt: 5 } }] },
    [{ $set: { ...fields, scrumMigratedAt: "$$NOW" } }],
    { session },
  );
}
