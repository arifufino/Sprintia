import type { MemberRole, ScrumRole } from "./types";

export const accessLabels: Record<MemberRole, string> = { owner: "Propietario", admin: "Administrador", member: "Miembro" };
export const scrumLabels: Record<ScrumRole, string> = { productOwner: "Product Owner", scrumMaster: "Scrum Master", developer: "Developer" };

// Technical access only. Scrum responsibilities NEVER grant permissions.
export function canManageProject(role: MemberRole | null | undefined) {
  return role === "owner" || role === "admin";
}

export function canManageAccess(role: MemberRole | null | undefined) {
  return role === "owner";
}
