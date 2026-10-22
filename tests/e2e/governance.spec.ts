import type { APIRequestContext } from "@playwright/test";
import type { Db, Document } from "mongodb";
import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";

const workspaces = (db: Db) => db.collection<Document & { _id: string }>("workspaces");
const memberships = (db: Db) => db.collection<Document & { _id: string }>("memberships");
const configuration = (patch: Record<string, unknown> = {}) => ({
  action: "updateScrumConfiguration", workspaceId: ids.alpha, governanceRevision: 0,
  productGoal: "Facilitar la planificación del equipo", definitionOfDone: ["Pruebas superadas", "Documentación revisada"],
  productOwnerId: users.owner.id, scrumMasterId: users.member.id, developerIds: [users.owner.id, users.member.id], ...patch,
});
const bootstrap = async (request: APIRequestContext) => {
  const response = await request.get(`/api/bootstrap?workspace=${ids.alpha}`);
  expect(response.status()).toBe(200);
  return response.json();
};

test("migración explícita, aislada e idempotente conserva acceso y no inventa responsabilidades", async ({ context, db }) => {
  await login(context);
  const before = await snapshot(db);
  const data = await bootstrap(context.request);
  expect(data.workspace).toMatchObject({ role: "owner", productGoal: "", definitionOfDone: [], productOwnerId: null, scrumMasterId: null, developerIds: [], governanceRevision: 0 });
  expect(data.members.every((member: { scrumRoles: string[] }) => member.scrumRoles.length === 0)).toBe(true);
  const after = await snapshot(db);
  for (const name of ["memberships", "tasks", "sprints", "counters", "activities"]) expect(after[name]).toEqual(before[name]);
  for (const id of [ids.beta, ids.gamma]) expect(after.workspaces.find((row: Document) => row._id === id)).toEqual(before.workspaces.find((row: Document) => row._id === id));
  expect(await workspaces(db).findOne({ _id: ids.alpha })).toMatchObject({ schemaVersion: 5, inviteCode: "TESTALPHA1234567", inviteEnabled: true, createdBy: users.owner.id });
  await bootstrap(context.request);
  expect(await snapshot(db)).toEqual(after);
  await login(context, users.member);
  const member = await bootstrap(context.request);
  expect(member.workspace.role).toBe("member");
  expect(member.workspace.inviteCode).toBeNull();
});

test("migración parcial conserva acuerdos, administradores e invitaciones revocadas", async ({ context, db }) => {
  await workspaces(db).updateOne({ _id: ids.alpha }, { $set: { productGoal: "Objetivo previo", definitionOfDone: ["Criterio previo"], scrumMasterId: users.member.id, developerIds: [users.owner.id], inviteEnabled: false, governanceRevision: 7, invitationRevision: 4 } });
  await memberships(db).updateOne({ workspaceId: ids.alpha, userId: users.member.id }, { $set: { role: "admin" } });
  await login(context, users.member);
  const data = await bootstrap(context.request);
  expect(data.workspace).toMatchObject({ role: "admin", productGoal: "Objetivo previo", definitionOfDone: ["Criterio previo"], scrumMasterId: users.member.id, developerIds: [users.owner.id], inviteEnabled: false, inviteCode: null, governanceRevision: 7, invitationRevision: 4 });
  expect(data.members.find((member: { id: string }) => member.id === users.owner.id).scrumRoles).toEqual(["developer"]);
});

for (const actor of ["owner", "admin", "member", "outsider"] as const) {
  test(`matriz de servidor: ${actor}, con comprobación directa de las tres mutaciones`, async ({ context, db }) => {
    if (actor === "admin") await memberships(db).updateOne({ workspaceId: ids.alpha, userId: users.member.id }, { $set: { role: "admin" } });
    await login(context, users[actor === "admin" ? "member" : actor]);
    const before = await snapshot(db);
    const manage = actor === "owner" || actor === "admin";
    const config = await mutate(context.request, configuration({ role: "owner" }));
    expect(config.status()).toBe(manage ? 200 : 403);
    const invite = await mutate(context.request, { action: "manageInvitation", workspaceId: ids.alpha, operation: "revoke", invitationRevision: 0, role: "owner" });
    expect(invite.status()).toBe(manage ? 200 : 403);
    const access = await mutate(context.request, { action: "updateMemberAccess", workspaceId: ids.alpha, userId: users.member.id, role: "admin", expectedRole: "member" });
    expect(access.status()).toBe(actor === "owner" ? 200 : 403);
    if (!manage) expect(await snapshot(db)).toEqual(before);
    if (actor === "owner") expect(await memberships(db).findOne({ workspaceId: ids.alpha, userId: users.member.id })).toMatchObject({ role: "admin" });
    if (manage) {
      expect(await workspaces(db).findOne({ _id: ids.alpha })).toMatchObject({ productGoal: "Facilitar la planificación del equipo", inviteEnabled: false });
      expect(await db.collection("activities").countDocuments({ workspaceId: ids.alpha })).toBeGreaterThanOrEqual(2);
    }
  });
}

test("responsabilidades Scrum no elevan permisos ni filtran códigos; colaborar sigue disponible", async ({ context }) => {
  await login(context);
  expect((await mutate(context.request, configuration({ productOwnerId: users.member.id }))).status()).toBe(200);
  await login(context, users.member);
  const data = await bootstrap(context.request);
  expect(data.members.find((member: { id: string }) => member.id === users.member.id)).toMatchObject({ role: "member", scrumRoles: ["productOwner", "scrumMaster", "developer"] });
  expect(data.workspaces.every((workspace: { inviteCode: string | null }) => workspace.inviteCode === null)).toBe(true);
  expect(JSON.stringify(data)).not.toContain("TESTALPHA1234567");
  expect((await mutate(context.request, configuration({ governanceRevision: 1 }))).status()).toBe(403);
  const create = await mutate(context.request, { action: "createTask", workspaceId: ids.alpha, title: "Trabajo del equipo", status: "backlog" });
  expect(create.status()).toBe(200);
  expect((await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, status: "progress" })).status()).toBe(200);
  expect((await mutate(context.request, { action: "createSprint", workspaceId: ids.alpha, name: "Sprint colaborativo" })).status()).toBe(200);
  expect((await mutate(context.request, { action: "deleteTask", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 1 })).status()).toBe(200);
});

test("protege al propietario, a integrantes ajenos y rechaza roles manipulados", async ({ context, db }) => {
  await login(context);
  const before = await snapshot(db);
  const input = { action: "updateMemberAccess", workspaceId: ids.alpha, userId: users.member.id, role: "admin", expectedRole: "member" };
  expect((await mutate(context.request, { ...input, userId: users.owner.id })).status()).toBe(403);
  expect((await mutate(context.request, { ...input, userId: users.outsider.id })).status()).toBe(400);
  for (const role of ["owner", ["admin"], { $ne: "member" }, null]) expect((await mutate(context.request, { ...input, role })).status()).toBe(400);
  expect((await mutate(context.request, { ...input, expectedRole: ["member"] })).status()).toBe(400);
  expect(await snapshot(db)).toEqual(before);
});

test("rechaza referencias Scrum ajenas y entradas inválidas sin escribir", async ({ context, db }) => {
  await login(context); await bootstrap(context.request);
  const before = await snapshot(db);
  for (const patch of [
    { productOwnerId: users.outsider.id }, { scrumMasterId: users.outsider.id }, { developerIds: [users.outsider.id] },
    { productOwnerId: { $ne: null } }, { developerIds: [users.member.id, users.member.id] }, { developerIds: "all" },
    { definitionOfDone: [""] }, { definitionOfDone: ["Igual", "Igual"] }, { definitionOfDone: ["x".repeat(301)] },
    { definitionOfDone: Array.from({ length: 21 }, (_, index) => `Criterio ${index}`) }, { definitionOfDone: "texto" },
    { productGoal: "x".repeat(1001) }, { productGoal: null }, { governanceRevision: -1 }, { governanceRevision: "0" },
  ]) expect((await mutate(context.request, configuration(patch))).status()).toBe(400);
  expect(await snapshot(db)).toEqual(before);
});

for (const action of ["updateScrumConfiguration", "updateMemberAccess", "manageInvitation"]) {
  test(`${action}: ni conocer un ID ni cambiar el workspace permite administrar otro proyecto`, async ({ context, db }) => {
    await login(context);
    const before = await snapshot(db);
    const response = await mutate(context.request, { ...configuration(), action, workspaceId: ids.beta, userId: users.outsider.id, role: "member", expectedRole: "admin", operation: "revoke", invitationRevision: 0 });
    expect(response.status()).toBe(403);
    expect(await snapshot(db)).toEqual(before);
  });
}

test("dos guardados concurrentes no sobrescriben configuración ni invitación silenciosamente", async ({ context, db }) => {
  await login(context); await bootstrap(context.request);
  const results = await Promise.all([mutate(context.request, configuration({ productGoal: "Versión A" })), mutate(context.request, configuration({ productGoal: "Versión B" }))]);
  expect(results.map((response) => response.status()).sort()).toEqual([200, 409]);
  const data = await bootstrap(context.request);
  expect(data.workspace.governanceRevision).toBe(1);
  const invites = await Promise.all(["revoke", "rotate"].map((operation) => mutate(context.request, { action: "manageInvitation", workspaceId: ids.alpha, operation, invitationRevision: 0 })));
  expect(invites.map((response) => response.status()).sort()).toEqual([200, 409]);
  expect((await workspaces(db).findOne({ _id: ids.alpha }))?.invitationRevision).toBe(1);
  const change = { action: "updateMemberAccess", workspaceId: ids.alpha, userId: users.member.id, expectedRole: "member", role: "admin" };
  expect((await mutate(context.request, change)).status()).toBe(200);
  expect((await mutate(context.request, { ...change, role: "member" })).status()).toBe(409);
});

test("renovar y revocar invalida enlaces previos; reactivar nunca los recupera ni expulsa al equipo", async ({ context, browser, db }) => {
  await login(context);
  const guest = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try {
    await login(guest, users.outsider);
    const manage = (operation: string, invitationRevision: number) => mutate(context.request, { action: "manageInvitation", workspaceId: ids.alpha, operation, invitationRevision });
    const join = (inviteCode: string) => mutate(guest.request, { action: "joinWorkspace", inviteCode, role: "owner", scrumMasterId: users.outsider.id });
    expect((await manage("rotate", 0)).status()).toBe(200);
    const rotated = (await bootstrap(context.request)).workspace.inviteCode;
    expect(rotated).not.toBe("TESTALPHA1234567");
    expect((await join("TESTALPHA1234567")).status()).toBe(400);
    expect((await join(rotated)).status()).toBe(200);
    expect(await memberships(db).findOne({ workspaceId: ids.alpha, userId: users.outsider.id })).toMatchObject({ role: "member" });
    expect((await manage("revoke", 1)).status()).toBe(200);
    expect((await bootstrap(context.request)).workspace).toMatchObject({ inviteCode: null, inviteEnabled: false });
    expect((await join(rotated)).status()).toBe(400);
    expect((await guest.request.get(`/api/bootstrap?workspace=${ids.alpha}`)).status()).toBe(200);
    expect((await manage("rotate", 2)).status()).toBe(200);
    const fresh = (await bootstrap(context.request)).workspace.inviteCode;
    expect(fresh).not.toBe(rotated);
    expect((await join(rotated)).status()).toBe(400);
    expect((await join(fresh)).status()).toBe(200);
    expect(await memberships(db).countDocuments({ workspaceId: ids.alpha, userId: users.outsider.id })).toBe(1);
    // An existing owner joining their own link must retain ownership.
    expect((await mutate(context.request, { action: "joinWorkspace", inviteCode: fresh })).status()).toBe(200);
    expect((await bootstrap(context.request)).workspace.role).toBe("owner");
    const activities = JSON.stringify(await db.collection("activities").find({ workspaceId: ids.alpha }).toArray());
    for (const secret of [rotated, fresh, "TESTALPHA1234567"]) expect(activities).not.toContain(secret);
  } finally { await guest.close(); }
});

test("proyectos nuevos nacen con permisos separados y sin responsabilidades inferidas", async ({ context, db }) => {
  await login(context);
  const response = await mutate(context.request, { action: "createWorkspace", name: "Proyecto nuevo Scrum", scrumMasterId: users.owner.id });
  expect(response.status()).toBe(200);
  const { workspaceId } = await response.json();
  expect(await workspaces(db).findOne({ _id: workspaceId })).toMatchObject({ schemaVersion: 5, scrumMasterId: null, productOwnerId: null, developerIds: [], productGoal: "", definitionOfDone: [] });
  expect(await memberships(db).findOne({ workspaceId, userId: users.owner.id })).toMatchObject({ role: "owner" });
});
