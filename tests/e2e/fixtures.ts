import { readFile } from "node:fs/promises";
import { test as base, expect, type BrowserContext, type APIRequestContext } from "@playwright/test";
import { MongoClient, type Db, type Document } from "mongodb";
import { encode } from "next-auth/jwt";

export const ids = {
  alpha: "ws_test_alpha", beta: "ws_test_beta", gamma: "ws_test_gamma",
  sprintAlpha: "sp_test_alpha", sprintBeta: "sp_test_beta", sprintGamma: "sp_test_gamma",
  taskAlpha: "task_test_alpha", taskBeta: "task_test_beta", taskGamma: "task_test_gamma",
};
export const users = {
  owner: { id: "test_ana", name: "Ana Pruebas", email: "ana@example.invalid" },
  member: { id: "test_bruno", name: "Bruno Pruebas", email: "bruno@example.invalid" },
  outsider: { id: "test_carla", name: "Carla Externa", email: "carla@example.invalid" },
};
type TestUser = typeof users.owner;
type Runtime = { origin: string; uri: string; databaseName: string; authSecret: string };
const collections = ["profiles", "workspaces", "memberships", "sprints", "tasks", "activities", "counters", "mutation_receipts", "task_updates", "daily_notes", "sprint_reviews", "review_entries", "review_revisions", "retro_observations", "retro_actions", "retro_updates"];
const now = "2026-10-12T15:00:00.000Z";

async function readRuntime(): Promise<Runtime> {
  const runtime: Runtime = JSON.parse(await readFile(new URL("../../.test-runtime.json", import.meta.url), "utf8"));
  const uri = new URL(runtime.uri);
  if (runtime.origin !== "http://127.0.0.1:4317" || uri.protocol !== "mongodb:" || uri.hostname !== "127.0.0.1"
    || uri.username || uri.password || !/^sprintia_e2e_[a-f0-9]{32}$/.test(runtime.databaseName)
    || uri.pathname !== `/${runtime.databaseName}`) {
    throw new Error("Prueba cancelada: solo se permite la base temporal local creada por el runner.");
  }
  return runtime;
}

async function seed(db: Db) {
  // Only these collections in the generated, loopback-only test database.
  for (const name of collections) await db.collection(name).deleteMany({});
  const insert = (name: string, docs: (Document & { _id: string })[]) => db.collection<Document & { _id: string }>(name).insertMany(docs);
  await insert("profiles", Object.values(users).map((user) => ({
    _id: user.id, authUserId: user.id, name: user.name, email: user.email, avatarColor: "#2f9c88", createdAt: now,
  })));
  await insert("workspaces", [
    { _id: ids.alpha, name: "Proyecto Alfa", inviteCode: "TESTALPHA1234567", createdBy: users.owner.id, createdAt: now },
    { _id: ids.beta, name: "Proyecto privado Beta", inviteCode: "TESTBETA12345678", createdBy: users.outsider.id, createdAt: now },
    { _id: ids.gamma, name: "Proyecto Gamma", inviteCode: "TESTGAMMA1234567", createdBy: users.owner.id, createdAt: now },
  ]);
  const membership = (workspaceId: string, userId: string, role: string, joinedAt = now) => ({
    _id: `${workspaceId}:${userId}`, workspaceId, userId, role, joinedAt,
  });
  await insert("memberships", [
    membership(ids.alpha, users.owner.id, "owner"), membership(ids.alpha, users.member.id, "member"),
    membership(ids.beta, users.outsider.id, "owner"), membership(ids.gamma, users.owner.id, "owner", "2026-10-12T16:00:00.000Z"),
  ]);
  await insert("sprints", [
    { _id: ids.sprintAlpha, workspaceId: ids.alpha, name: "Sprint Alfa" },
    { _id: ids.sprintBeta, workspaceId: ids.beta, name: "Sprint confidencial Beta" },
    { _id: ids.sprintGamma, workspaceId: ids.gamma, name: "Sprint Gamma" },
  ].map((sprint) => ({ ...sprint, goal: "Validar el recorrido del equipo", status: "active", startDate: "2026-10-01", endDate: "2026-10-14", createdAt: now })));
  await insert("tasks", [
    { _id: ids.taskAlpha, workspaceId: ids.alpha, sprintId: ids.sprintAlpha, title: "Preparar entrevista Alfa", assigneeId: users.owner.id, reporterId: users.owner.id, code: "UNI-01", status: "todo" },
    { _id: "task_test_backlog", workspaceId: ids.alpha, sprintId: null, title: "Idea pendiente Alfa", assigneeId: null, reporterId: users.owner.id, code: "UNI-02", status: "backlog" },
    { _id: ids.taskBeta, workspaceId: ids.beta, sprintId: ids.sprintBeta, title: "Contenido confidencial Beta", assigneeId: users.outsider.id, reporterId: users.outsider.id, code: "UNI-01", status: "todo" },
    { _id: ids.taskGamma, workspaceId: ids.gamma, sprintId: ids.sprintGamma, title: "Preparar informe Gamma", assigneeId: users.owner.id, reporterId: users.owner.id, code: "UNI-01", status: "todo" },
  ].map((task, index) => ({ ...task, description: "Documentar el objetivo y compartir los resultados con el equipo.", priority: "medium", points: 3, sortOrder: index, createdAt: now, updatedAt: now })));
}

export async function login(context: BrowserContext, user: TestUser = users.owner) {
  const runtime = await readRuntime();
  await setSession(context, { sub: user.id, userId: user.id, name: user.name, email: user.email }, runtime);
}

export async function setSession(context: BrowserContext, token: Record<string, unknown>, runtime?: Runtime, maxAge = 3600, wrongSecret = false) {
  const settings = runtime ?? await readRuntime();
  const name = "authjs.session-token";
  const value = await encode({ token, secret: wrongSecret ? "invalid-test-secret" : settings.authSecret, salt: name, maxAge });
  await context.addCookies([{ name, value, url: settings.origin, httpOnly: true, sameSite: "Lax", secure: false }]);
}

export function mutate(request: APIRequestContext, data: Record<string, unknown>) {
  return request.post("/api/mutate", { data: { mutationId: crypto.randomUUID(),
    ...(["updateTask", "deleteTask"].includes(String(data.action)) ? { revision: 0 } : {}),
    ...(data.action === "updateMemberAccess" ? { accessRevision: 0 } : {}), ...data }, headers: { Origin: "http://127.0.0.1:4317" } });
}

export async function snapshot(db: Db) {
  return Object.fromEntries(await Promise.all(collections.map(async (name) => [name, await db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
}

export const test = base.extend<{ db: Db }>({
  db: [async ({}, provideDb) => {
    const runtime = await readRuntime();
    const client = await new MongoClient(runtime.uri).connect();
    try {
      const db = client.db(runtime.databaseName);
      await seed(db);
      await provideDb(db);
    } finally {
      await client.close();
    }
  }, { auto: true }],
});
export { expect };
