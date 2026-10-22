import type { APIRequestContext } from "@playwright/test";
import type { Db } from "mongodb";
import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";

const day = "2026-10-21";
const block = (patch: Record<string, unknown> = {}) => ({ action: "changeImpediment", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 0, operation: "report", reason: "Falta acceso al entorno compartido", ownerId: users.member.id, ...patch });
const comment = (patch: Record<string, unknown> = {}) => ({ action: "addTaskComment", workspaceId: ids.alpha, id: ids.taskAlpha, text: "Solicitamos el acceso al responsable del laboratorio.", ...patch });
const note = (patch: Record<string, unknown> = {}) => ({ action: "saveDailyNote", workspaceId: ids.alpha, sprintId: ids.sprintAlpha, date: day, text: "Validar la entrega en cuanto llegue el acceso.", revision: 0, ...patch });
const bootstrap = async (request: APIRequestContext) => (await request.get(`/api/bootstrap?workspace=${ids.alpha}`)).json();
const discussion = async (request: APIRequestContext, before = "") => (await request.get(`/api/discussion?workspace=${ids.alpha}&task=${ids.taskAlpha}${before ? `&before=${before}` : ""}`)).json();
const daily = async (request: APIRequestContext, date = day) => (await request.get(`/api/daily?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&date=${date}`)).json();
async function current(request: APIRequestContext) { return (await bootstrap(request)).tasks.find((task: { id: string }) => task.id === ids.taskAlpha); }
async function openConversation(page: import("@playwright/test").Page) {
  await page.goto(`/?workspace=${ids.alpha}&view=board&sprint=${ids.sprintAlpha}&task=${ids.taskAlpha}`);
  const dialog = page.getByRole("dialog", { name: "UNI-01", exact: true });
  await dialog.getByRole("button", { name: "Conversación e impedimentos", exact: true }).click();
  return dialog;
}

test("phase10 legacy tasks, notes and conversations project empty without fabricating records", async ({ context, db }) => {
  await login(context); const data = await bootstrap(context.request);
  expect(data.tasks[0]).toMatchObject({ impediment: null, discussionRevision: 0 }); expect(data.sprints[0].dailyRevision).toBe(0);
  expect(await discussion(context.request)).toEqual({ entries: [], nextCursor: null });
  expect(await daily(context.request)).toEqual({ text: "", revision: 0, updatedAt: null, updatedByName: null });
  expect(await db.collection("daily_notes").countDocuments()).toBe(0); expect(await db.collection("task_updates").countDocuments()).toBe(0);
  expect(await db.collection("tasks").countDocuments({ impediment: { $exists: true } })).toBe(0);
});

test("phase10 block, reassign, resolve and reopen retain history without moving or estimating work", async ({ context, db }) => {
  await login(context); const original = await current(context.request);
  const payload = block({ mutationId: crypto.randomUUID() }); expect((await mutate(context.request, payload)).status()).toBe(200);
  const first = await current(context.request); expect(first).toMatchObject({ revision: 1, status: original.status, points: original.points, sortOrder: original.sortOrder, impediment: { reason: payload.reason, ownerId: users.member.id, ownerName: users.member.name, createdById: users.owner.id } });
  const after = await snapshot(db); expect((await mutate(context.request, payload)).status()).toBe(200); expect(await snapshot(db)).toEqual(after);
  expect((await mutate(context.request, block({ operation: "update", revision: 1, impedimentId: first.impediment.id, ownerId: users.owner.id, reason: "Acceso pendiente de aprobación" }))).status()).toBe(200);
  const updated = await current(context.request); expect(updated.impediment.id).toBe(first.impediment.id);
  expect((await mutate(context.request, block({ operation: "resolve", revision: 2, impedimentId: first.impediment.id, resolution: "Acceso verificado por el equipo" }))).status()).toBe(200);
  expect(await current(context.request)).toMatchObject({ revision: 3, impediment: null, status: original.status });
  expect((await mutate(context.request, block({ revision: 3 }))).status()).toBe(200); const reopened = await current(context.request); expect(reopened.impediment.id).not.toBe(first.impediment.id);
  const history = await discussion(context.request); expect(history.entries.map((entry: { kind: string }) => entry.kind).sort()).toEqual(["impediment.reported", "impediment.reported", "impediment.resolved", "impediment.updated"]);
  expect(history.entries.find((entry: { kind: string }) => entry.kind === "impediment.resolved")).toMatchObject({ text: "Acceso verificado por el equipo", before: { reason: "Acceso pendiente de aprobación" }, after: null });
});

test("phase10 malformed or cross-team impediments have no effects", async ({ context, db }) => {
  await login(context); await bootstrap(context.request); const before = await snapshot(db);
  for (const patch of [{ reason: " " }, { reason: "x".repeat(1001) }, { reason: 6 }, { ownerId: users.outsider.id }, { ownerId: "" }, { operation: "fake" }, { revision: -1 }, { revision: undefined }, { id: ids.taskBeta }]) {
    expect((await mutate(context.request, block(patch))).status()).toBe(400); expect(await snapshot(db)).toEqual(before);
  }
  expect((await mutate(context.request, block({ workspaceId: ids.beta, id: ids.taskBeta }))).status()).toBe(403); expect(await snapshot(db)).toEqual(before);
});

test("phase10 blockers survive backlog transfers and must be resolved before completion", async ({ context }) => {
  await login(context); await mutate(context.request, block()); const active = await current(context.request);
  expect((await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 1, status: "done", impediment: null })).status()).toBe(409);
  expect((await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 1, status: "backlog" })).status()).toBe(200);
  const backlog = await current(context.request); expect(backlog).toMatchObject({ status: "backlog", sprintId: null, impediment: active.impediment });
  expect((await mutate(context.request, block({ operation: "resolve", revision: 2, impedimentId: active.impediment.id, resolution: "Dependencia desbloqueada" }))).status()).toBe(200);
  expect((await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 3, status: "done", sprintId: ids.sprintAlpha })).status()).toBe(200);
  expect((await mutate(context.request, block({ revision: 4 }))).status()).toBe(409);
});

test("phase10 concurrent reports and stale resolutions cannot overwrite another session", async ({ browser, context, db }) => {
  await login(context); const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try { await login(other, users.member); const results = await Promise.all([mutate(context.request, block()), mutate(other.request, block({ reason: "Otra dependencia" }))]); expect(results.map((response) => response.status()).sort()).toEqual([200, 409]); }
  finally { await other.close(); }
  const task = await current(context.request); const before = await snapshot(db);
  expect((await mutate(context.request, block({ operation: "resolve", impedimentId: task.impediment.id, resolution: "No sobreescribir" }))).status()).toBe(409); expect(await snapshot(db)).toEqual(before);
  expect((await mutate(context.request, block({ operation: "resolve", revision: 1, impedimentId: "old_id", resolution: "No resolver otro" }))).status()).toBe(409);
});

for (const action of ["changeImpediment", "addTaskComment", "saveDailyNote"]) {
  test(`phase10 ${action} rolls back data, timeline, versions and receipt when audit fails`, async ({ context, db }) => {
    await login(context); await bootstrap(context.request); const before = await snapshot(db);
    await db.command({ collMod: "activities", validator: { "event.type": { $exists: false } }, validationLevel: "strict", validationAction: "error" });
    try { expect((await mutate(context.request, action === "changeImpediment" ? block() : action === "addTaskComment" ? comment() : note())).status()).toBe(500); expect(await snapshot(db)).toEqual(before); }
    finally { await db.command({ collMod: "activities", validator: {}, validationLevel: "off" }); }
  });
}

test("phase10 concurrent comments both persist, retry once, and do not invalidate a task draft", async ({ browser, context, db }) => {
  await login(context); const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  const first = comment({ mutationId: crypto.randomUUID() });
  try { await login(other, users.member); const results = await Promise.all([mutate(context.request, first), mutate(other.request, comment({ text: "Comparto una alternativa" }))]); expect(results.map((response) => response.status())).toEqual([200, 200]); }
  finally { await other.close(); }
  expect(await current(context.request)).toMatchObject({ revision: 0, discussionRevision: 2 });
  const before = await snapshot(db); expect((await mutate(context.request, first)).status()).toBe(200); expect(await snapshot(db)).toEqual(before);
  expect((await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, title: "Edición de contenido independiente" })).status()).toBe(200);
  expect((await discussion(context.request)).entries).toHaveLength(2);
  await db.collection("memberships").deleteOne({ workspaceId: ids.alpha, userId: users.owner.id }); expect((await mutate(context.request, first)).status()).toBe(403);
});

test("phase10 discussion pagination handles equal timestamps without gaps, duplicates or foreign entries", async ({ context, db }) => {
  await login(context); await bootstrap(context.request);
  await db.collection("task_updates").insertMany(Array.from({ length: 65 }, (_, index) => ({ _id: `comment_seed_${String(index).padStart(3, "0")}` as never, workspaceId: ids.alpha, taskId: ids.taskAlpha, kind: "comment", text: `Mensaje ${index}`, actorId: users.owner.id, actorName: users.owner.name, createdAt: "2026-10-21T15:00:00.000Z", before: null, after: null })));
  await db.collection("task_updates").insertOne({ _id: "comment_foreign" as never, workspaceId: ids.beta, taskId: ids.taskBeta, kind: "comment", text: "Mensaje privado", createdAt: "2026-10-21T15:00:00.000Z" });
  const first = await discussion(context.request); expect(first.entries).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
  const second = await discussion(context.request, first.nextCursor); expect(second.entries).toHaveLength(15); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(65);
  expect((await context.request.get(`/api/discussion?workspace=${ids.alpha}&task=${ids.taskAlpha}&before=comment_foreign`)).status()).toBe(400);
});

test("phase10 new read endpoints enforce session, parameter boundaries and project access", async ({ context, request, db }) => {
  const paths = [`/api/discussion?workspace=${ids.alpha}&task=${ids.taskAlpha}`, `/api/daily?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&date=${day}`];
  for (const path of paths) expect((await request.get(path)).status()).toBe(401);
  await login(context); await bootstrap(context.request); const before = await snapshot(db);
  for (const path of [`/api/discussion?workspace=${ids.beta}&task=${ids.taskBeta}`, `/api/discussion?workspace=${ids.alpha}&task=${ids.taskBeta}`, `/api/daily?workspace=${ids.beta}&sprint=${ids.sprintBeta}&date=${day}`, `/api/daily?workspace=${ids.alpha}&sprint=${ids.sprintBeta}&date=${day}`]) expect((await context.request.get(path)).status()).toBe(404);
  for (const path of [`/api/discussion?workspace=${ids.alpha}&task=${ids.taskAlpha}&task=other`, `/api/discussion?workspace=${ids.alpha}`, `/api/daily?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&date=2026-02-30`, `/api/daily?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&date=${day}&date=${day}`]) expect((await context.request.get(path)).status()).toBe(400);
  for (const text of [" ", 8, "x".repeat(2001)]) expect((await mutate(context.request, comment({ text }))).status()).toBe(400);
  expect((await mutate(context.request, comment({ workspaceId: ids.beta, id: ids.taskBeta }))).status()).toBe(403);
  expect(await snapshot(db)).toEqual(before);
});

test("phase10 optional daily notes are versioned, idempotent and independent of task planning versions", async ({ context, db }) => {
  await login(context); const initial = await bootstrap(context.request);
  expect((await mutate(context.request, note({ text: "" }))).status()).toBe(200); expect(await db.collection("daily_notes").countDocuments()).toBe(0);
  const payload = note({ mutationId: crypto.randomUUID() }); expect((await mutate(context.request, payload)).status()).toBe(200);
  expect(await daily(context.request)).toMatchObject({ revision: 1, text: payload.text, updatedByName: users.owner.name });
  const before = await snapshot(db); expect((await mutate(context.request, payload)).status()).toBe(200); expect(await snapshot(db)).toEqual(before);
  expect((await bootstrap(context.request)).sprints[0]).toMatchObject({ revision: initial.sprints[0].revision, dailyRevision: 1 });
  expect((await mutate(context.request, note({ date: "2026-10-20", text: "Otro día" }))).status()).toBe(200);
  expect((await mutate(context.request, note({ revision: 1, text: "" }))).status()).toBe(200); expect(await daily(context.request)).toMatchObject({ revision: 2, text: "" });
  expect(await daily(context.request, "2026-10-20")).toMatchObject({ text: "Otro día", revision: 1 });
});

test("phase10 concurrent note updates reject a stale draft without losing either author's content", async ({ browser, context }) => {
  await login(context); const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try { await login(other, users.member); const results = await Promise.all([mutate(context.request, note({ text: "Acuerdo de Ana" })), mutate(other.request, note({ text: "Acuerdo de Bruno" }))]); expect(results.map((response) => response.status()).sort()).toEqual([200, 409]); }
  finally { await other.close(); }
  expect(["Acuerdo de Ana", "Acuerdo de Bruno"]).toContain((await daily(context.request)).text);
});

test("phase10 note validation, sprint state and foreign targets cannot mutate data", async ({ context, db }) => {
  await login(context); await bootstrap(context.request); const before = await snapshot(db);
  for (const patch of [{ date: "2026-02-30" }, { date: "" }, { date: undefined }, { text: 6 }, { text: "x".repeat(2001) }, { revision: undefined }, { revision: "0" }]) { expect((await mutate(context.request, note(patch))).status()).toBe(400); expect(await snapshot(db)).toEqual(before); }
  expect((await mutate(context.request, note({ sprintId: ids.sprintBeta }))).status()).toBe(409);
  expect((await mutate(context.request, note({ workspaceId: ids.beta, sprintId: ids.sprintBeta }))).status()).toBe(403);
  await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "planned" } }); expect((await mutate(context.request, note())).status()).toBe(409);
});

test("phase10 closure freezes blocker context and makes note/conversation read-only while returned work stays actionable", async ({ context }) => {
  await login(context); await mutate(context.request, block()); await mutate(context.request, comment()); await mutate(context.request, note());
  const task = await current(context.request);
  expect((await mutate(context.request, { action: "closeSprint", workspaceId: ids.alpha, id: ids.sprintAlpha, revision: 1, governanceRevision: 0, reviewed: true, summary: "Pendiente de la dependencia" })).status()).toBe(200);
  const frozen = (await bootstrap(context.request)).sprints[0].outcome;
  expect(frozen.tasks[0].impediment).toEqual(task.impediment);
  expect((await mutate(context.request, note({ revision: 1 }))).status()).toBe(409); expect((await daily(context.request)).text).toBe(note().text);
  // Incomplete work is now in backlog; its conversation can continue.
  expect((await mutate(context.request, comment({ text: "Seguimos resolviendo desde el backlog" }))).status()).toBe(200);
  expect((await mutate(context.request, block({ operation: "resolve", revision: 2, impedimentId: task.impediment.id, resolution: "Acceso conseguido" }))).status()).toBe(200);
  expect((await bootstrap(context.request)).sprints[0].outcome).toEqual(frozen);
});

test("phase10 finished tasks reject comments and blockers and task deletion removes its conversation atomically", async ({ context, db }) => {
  await login(context); await mutate(context.request, comment()); expect((await mutate(context.request, { action: "deleteTask", workspaceId: ids.alpha, id: ids.taskAlpha })).status()).toBe(200);
  expect(await db.collection("task_updates").countDocuments({ taskId: ids.taskAlpha })).toBe(0); expect((await context.request.get(`/api/discussion?workspace=${ids.alpha}&task=${ids.taskAlpha}`)).status()).toBe(404);
  await db.collection("sprints").updateOne({ _id: ids.sprintGamma as never }, { $set: { status: "completed" } });
  expect((await mutate(context.request, comment({ workspaceId: ids.gamma, id: ids.taskGamma }))).status()).toBe(409); expect((await mutate(context.request, block({ workspaceId: ids.gamma, id: ids.taskGamma }))).status()).toBe(409);
});

test("phase10 UI reports a blocker, shares a comment, finds it in Daily and resolves it with history", async ({ page, context }) => {
  await login(context); const dialog = await openConversation(page);
  await dialog.getByRole("button", { name: "Registrar bloqueo", exact: true }).click();
  await dialog.getByLabel("Qué impide avanzar", { exact: true }).fill("Necesitamos acceso al repositorio"); await dialog.getByLabel("Responsable de seguimiento", { exact: true }).selectOption(users.member.id);
  await dialog.getByRole("button", { name: "Guardar bloqueo", exact: true }).click(); await expect(dialog.getByRole("heading", { name: "Esta tarea está bloqueada" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Editar seguimiento" })).toBeVisible();
  await dialog.getByLabel("Nuevo comentario", { exact: true }).fill("Ya solicitamos el acceso"); await dialog.getByRole("button", { name: "Enviar comentario" }).click();
  await expect(dialog.getByRole("region", { name: "Historial y conversación" }).getByRole("listitem").filter({ hasText: "Ya solicitamos el acceso" })).toBeVisible();
  await expect(dialog.getByLabel("Nuevo comentario", { exact: true })).toHaveValue("");
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.locator(".task-card .blocked-badge")).toHaveText(/Bloqueada/);
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("button", { name: "Daily", exact: true }).click();
  await expect(page.getByRole("region", { name: "Trabajo para conversar" })).toContainText("Necesitamos acceso al repositorio");
  await page.getByRole("button", { name: "Revisar bloqueo de UNI-01", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "UNI-01", exact: true }); await detail.getByRole("button", { name: "Conversación e impedimentos" }).click(); await detail.getByRole("button", { name: "Resolver bloqueo", exact: true }).click();
  await detail.getByLabel("Cómo se resolvió", { exact: true }).fill("Acceso comprobado por el equipo"); await detail.getByRole("button", { name: "Confirmar resolución" }).click();
  await expect(detail.getByRole("heading", { name: "Sin impedimentos abiertos" })).toBeVisible(); await expect(detail.getByRole("region", { name: "Historial y conversación" })).toContainText("Acceso comprobado por el equipo");
  await page.keyboard.press("Escape"); await expect(detail).toHaveCount(0); await expect(page.getByRole("region", { name: "Trabajo para conversar" })).toContainText("No hay bloqueos abiertos");
});

test("phase10 conversation draft survives reload, a failed send and unsafe markup is rendered as text", async ({ page, context }) => {
  await login(context); let dialog = await openConversation(page); const input = dialog.getByLabel("Nuevo comentario", { exact: true });
  await input.fill('<img src=x onerror="window.injected=true"> [No ejecutar](javascript:alert(1))');
  await page.reload(); dialog = page.getByRole("dialog", { name: "UNI-01", exact: true }); await dialog.getByRole("button", { name: "Conversación e impedimentos" }).click();
  await expect(dialog.getByLabel("Nuevo comentario", { exact: true })).toHaveValue(/window.injected/);
  await page.route("**/api/mutate", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "No se pudo enviar" }) }), { times: 1 });
  await dialog.getByRole("button", { name: "Enviar comentario" }).click(); await expect(dialog.getByRole("alert")).toContainText("No se pudo enviar"); await expect(dialog.getByLabel("Nuevo comentario", { exact: true })).toHaveValue(/window.injected/);
  await dialog.getByRole("button", { name: "Enviar comentario" }).click(); const history = dialog.getByRole("region", { name: "Historial y conversación" }); await expect(history).toContainText("<img src=x"); await expect(history.locator("img, a")).toHaveCount(0); await expect(dialog.getByLabel("Nuevo comentario", { exact: true })).toHaveValue("");
});

test("phase10 daily notes preserve stale drafts and the selected day across reload", async ({ page, context }) => {
  await login(context); await page.goto(`/?workspace=${ids.alpha}&view=daily&sprint=${ids.sprintAlpha}&day=${day}`);
  const notes = page.getByRole("region", { name: "Acuerdos de Daily" }); await notes.getByLabel("Notas del equipo", { exact: true }).fill("Mi acuerdo sin compartir");
  await mutate(context.request, note({ text: "Acuerdo de otra sesión" })); await notes.getByRole("button", { name: "Guardar acuerdos" }).click();
  await expect(notes).toContainText("Las notas cambiaron en otra sesión"); await expect(notes.getByLabel("Notas del equipo", { exact: true })).toHaveValue("Mi acuerdo sin compartir");
  await page.reload(); await expect(notes.getByLabel("Notas del equipo", { exact: true })).toHaveValue("Mi acuerdo sin compartir");
  await notes.getByRole("button", { name: "Cargar notas actuales y descartar mi borrador" }).click(); await expect(notes.getByLabel("Notas del equipo", { exact: true })).toHaveValue("Acuerdo de otra sesión");
  await notes.getByLabel("Notas del equipo", { exact: true }).fill("Acuerdo revisado juntos"); await notes.getByRole("button", { name: "Guardar acuerdos" }).click(); await expect(notes.getByRole("button", { name: "Guardar acuerdos" })).toBeDisabled();
  await page.getByLabel("Fecha de la Daily", { exact: true }).fill("2026-10-20"); await expect(page).toHaveURL(/day=2026-10-20/); await expect(notes.getByLabel("Notas del equipo", { exact: true })).toHaveValue("");
  await page.reload(); await expect(page.getByLabel("Fecha de la Daily", { exact: true })).toHaveValue("2026-10-20");
});

for (const action of ["addTaskComment", "saveDailyNote"]) {
  test(`phase10 uncertain ${action} recovers its original key and clears only its confirmed text draft`, async ({ page, context, db }) => {
    await login(context);
    if (action === "addTaskComment") { const dialog = await openConversation(page); await dialog.getByLabel("Nuevo comentario", { exact: true }).fill("Un solo mensaje"); }
    else { await page.goto(`/?workspace=${ids.alpha}&view=daily&sprint=${ids.sprintAlpha}&day=${day}`); await page.getByLabel("Notas del equipo", { exact: true }).fill("Un solo acuerdo"); }
    const keys: string[] = []; await page.route("**/api/mutate", async (route) => { keys.push(route.request().postDataJSON().mutationId); if (keys.length === 1) { await route.fetch(); await route.abort("failed"); } else await route.continue(); });
    await page.getByRole("button", { name: action === "addTaskComment" ? "Enviar comentario" : "Guardar acuerdos", exact: true }).click(); await expect(page.getByRole("alert").first()).toContainText("No pudimos confirmar");
    page.on("dialog", (warning) => warning.accept()); await page.reload();
    const retry = action === "addTaskComment" ? page.getByRole("dialog", { name: "UNI-01", exact: true }).getByRole("button", { name: "Reintentar cambio pendiente", exact: true }) : page.getByLabel("Estado de sincronización").getByRole("button", { name: "Reintentar cambio pendiente" });
    await retry.click(); await expect(page.getByLabel("Estado de sincronización")).toContainText("Actualizado");
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
    if (action === "addTaskComment") { const dialog = page.getByRole("dialog", { name: "UNI-01", exact: true }); await dialog.getByRole("button", { name: "Conversación e impedimentos" }).click(); await expect(dialog.getByLabel("Nuevo comentario", { exact: true })).toHaveValue(""); expect(await db.collection("task_updates").countDocuments()).toBe(1); }
    else { await expect(page.getByLabel("Notas del equipo", { exact: true })).toHaveValue("Un solo acuerdo"); await expect(page.getByRole("button", { name: "Guardar acuerdos", exact: true })).toBeDisabled(); expect(await db.collection("daily_notes").countDocuments()).toBe(1); }
  });
}

test("phase10 inline blocker form exits with motion, restores focus and supports reduced motion", async ({ page, context }) => {
  await login(context); const dialog = await openConversation(page); await dialog.getByRole("button", { name: "Registrar bloqueo", exact: true }).click();
  await expect(dialog.getByLabel("Qué impide avanzar", { exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Volver sin guardar" }).click(); await expect(dialog.getByLabel("Qué impide avanzar", { exact: true })).toHaveCount(0); await expect(dialog.getByRole("button", { name: "Registrar bloqueo", exact: true })).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" }); await dialog.getByRole("button", { name: "Registrar bloqueo", exact: true }).click(); await dialog.getByRole("button", { name: "Volver sin guardar" }).click(); await expect(dialog.getByLabel("Qué impide avanzar", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
});

test("phase10 a remote closure keeps an unsent comment available to copy and historical tasks expose their conversation", async ({ page, context, db }) => {
  await db.collection("tasks").updateOne({ _id: ids.taskAlpha as never }, { $set: { status: "done" } });
  await login(context); const dialog = await openConversation(page); await dialog.getByLabel("Nuevo comentario", { exact: true }).fill("Comentario conservado antes del cierre");
  expect((await mutate(context.request, { action: "closeSprint", workspaceId: ids.alpha, id: ids.sprintAlpha, revision: 0, governanceRevision: 0, reviewed: true, summary: "Resultado entregado" })).status()).toBe(200);
  await dialog.getByRole("button", { name: "Enviar comentario" }).click();
  await expect(dialog).toContainText("solo lectura"); await expect(dialog.getByLabel("Mi comentario sin enviar · puedes copiarlo", { exact: true })).toHaveValue("Comentario conservado antes del cierre");
  await dialog.getByRole("button", { name: "Listo", exact: true }).click(); await expect(dialog).toHaveCount(0);
  const archive = page.getByRole("region", { name: "Resultado histórico del sprint" }); await archive.getByText("UNI-01 · Preparar entrevista Alfa", { exact: true }).click();
  await archive.getByRole("button", { name: "Ver tarea y conversación actuales" }).click(); await expect(page.getByRole("dialog", { name: "UNI-01", exact: true })).toContainText("Conversación de solo lectura");
});

async function visualSeed(db: Db) {
  const impediment = { id: "impediment_visual", reason: "Falta acceso al entorno de pruebas del laboratorio", ownerId: users.member.id, ownerName: users.member.name, createdAt: "2026-10-21T14:00:00.000Z", createdById: users.owner.id, createdByName: users.owner.name, updatedAt: "2026-10-21T14:00:00.000Z" };
  await db.collection("tasks").updateOne({ _id: ids.taskAlpha as never }, { $set: { impediment, status: "progress", discussionRevision: 2 } });
  await db.collection("task_updates").insertMany([
    { _id: "comment_visual_a" as never, workspaceId: ids.alpha, taskId: ids.taskAlpha, kind: "impediment.reported", text: impediment.reason, actorId: users.owner.id, actorName: users.owner.name, createdAt: impediment.createdAt, before: null, after: impediment },
    { _id: "comment_visual_b" as never, workspaceId: ids.alpha, taskId: ids.taskAlpha, kind: "comment", text: "Ya solicitamos el acceso. Hoy revisaremos una alternativa con el equipo.", actorId: users.member.id, actorName: users.member.name, createdAt: "2026-10-21T14:10:00.000Z", before: null, after: null },
  ]);
}

test("phase10 loading older discussion and refreshing over a page of new messages leaves no gaps or lost draft", async ({ page, context, db }) => {
  const seed = (prefix: string, count: number, at: string) => db.collection("task_updates").insertMany(Array.from({ length: count }, (_, index) => ({ _id: `${prefix}_${String(index).padStart(3, "0")}` as never, workspaceId: ids.alpha, taskId: ids.taskAlpha, kind: "comment", text: `${prefix} ${index}`, actorId: users.owner.id, actorName: users.owner.name, createdAt: at, before: null, after: null })));
  await seed("comment_old", 65, "2026-10-21T14:00:00.000Z"); await login(context); const dialog = await openConversation(page);
  const messages = dialog.getByRole("region", { name: "Historial y conversación" }).getByRole("listitem"); await expect(messages).toHaveCount(50);
  await dialog.getByRole("button", { name: "Cargar mensajes anteriores" }).click(); await expect(messages).toHaveCount(65);
  await dialog.getByLabel("Nuevo comentario", { exact: true }).fill("Borrador que no debe desaparecer");
  await seed("comment_new", 60, "2026-10-21T16:00:00.000Z"); await dialog.getByRole("button", { name: "Actualizar conversación" }).click(); await expect(messages).toHaveCount(115);
  await dialog.getByRole("button", { name: "Cargar mensajes anteriores" }).click(); await expect(messages).toHaveCount(125);
  await expect(dialog.getByLabel("Nuevo comentario", { exact: true })).toHaveValue("Borrador que no debe desaparecer");
});
for (const width of [320, 390, 1107]) {
  test(`phase10 Daily and task discussion remain readable at ${width}px`, async ({ page, context, db }) => {
    await visualSeed(db); await login(context); await page.setViewportSize({ width, height: 958 }); await page.clock.setFixedTime(new Date("2026-10-21T15:00:00.000Z"));
    await page.addInitScript((light) => { localStorage.setItem("sprintia-theme", light ? "light" : "dark"); localStorage.setItem("sprintia-text-size", "xlarge"); }, width === 390);
    await page.goto(`/?workspace=${ids.alpha}&view=daily&sprint=${ids.sprintAlpha}&day=${day}`); await expect(page.getByLabel("Notas del equipo", { exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (width < 900) expect(await page.getByRole("navigation", { name: "Navegación móvil" }).locator("button").evaluateAll((buttons) => buttons.every((button) => { const label = button.querySelector("span")!.getBoundingClientRect(); const box = button.getBoundingClientRect(); return label.left >= box.left - 1 && label.right <= box.right + 1; }))).toBe(true);
    await expect(page).toHaveScreenshot(`phase-10-daily-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
    await page.getByRole("button", { name: "Revisar bloqueo de UNI-01", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "UNI-01", exact: true }); await dialog.getByRole("button", { name: "Conversación e impedimentos", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "Historial y conversación" })).toContainText("Ya solicitamos el acceso");
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await dialog.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("*")).filter((node) => node.getClientRects().length && Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.textContent))).toEqual([]);
    await dialog.evaluate((el) => { el.scrollTop = 0; }); await expect(page).toHaveScreenshot(`phase-10-discussion-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
  });
}
