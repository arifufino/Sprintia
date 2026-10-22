import type { APIRequestContext } from "@playwright/test";
import type { Db } from "mongodb";
import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";

const end = (patch: Record<string, unknown> = {}) => ({ action: "closeSprint", workspaceId: ids.alpha, id: ids.sprintAlpha, revision: 0, governanceRevision: 0, summary: "Entrevistas preparadas; falta compartir resultados.", reviewed: true, ...patch });
const bootstrap = async (request: APIRequestContext) => (await request.get(`/api/bootstrap?workspace=${ids.alpha}`)).json();
async function mixed(db: Db) {
  const source = await db.collection("tasks").findOne({ _id: ids.taskAlpha as never });
  await db.collection("tasks").insertOne({ ...source, _id: "task_test_done" as never, code: "UNI-03", title: "Resultado ya entregado", status: "done", points: 5, sortOrder: 9, acceptanceCriteria: ["Resultado comprobado"], checklist: [{ id: "step-a", text: "Revisado por el equipo", done: true }] });
}

test("phase9 closure freezes scope and agreements, appends incomplete work to backlog and starts no other sprint", async ({ context, db }) => {
  await login(context); await mixed(db);
  await db.collection("workspaces").updateOne({ _id: ids.alpha as never }, { $set: { definitionOfDone: ["Probado con usuarios"], productGoal: "Una entrega útil" } });
  const next = await mutate(context.request, { action: "createSprint", workspaceId: ids.alpha, name: "Plan siguiente", goal: "Nuevo objetivo" });
  expect(next.status()).toBe(200);
  const nextId = (await next.json()).sprintId;
  const before = await bootstrap(context.request);
  const payload = end({ mutationId: crypto.randomUUID() });
  expect((await mutate(context.request, payload)).status()).toBe(200);
  const data = await bootstrap(context.request); const sprint = data.sprints.find((s: { id: string }) => s.id === ids.sprintAlpha);
  expect(sprint).toMatchObject({ status: "completed", revision: 1, outcome: { kind: "completed", actorId: users.owner.id, actorName: users.owner.name, summary: payload.summary, reason: "", definitionOfDone: ["Probado con usuarios"], productGoal: "Una entrega útil", plan: { name: "Sprint Alfa", startedAt: null } } });
  expect(Date.parse(sprint.outcome.endedAt)).not.toBeNaN();
  expect(sprint.outcome.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.taskAlpha, status: "todo", returnedToBacklog: true }), expect.objectContaining({ id: "task_test_done", status: "done", returnedToBacklog: false, acceptanceCriteria: ["Resultado comprobado"] })]));
  const returned = data.tasks.find((t: { id: string }) => t.id === ids.taskAlpha);
  expect(returned).toMatchObject({ sprintId: null, status: "backlog", revision: 1, title: "Preparar entrevista Alfa" });
  expect(returned.sortOrder).toBeGreaterThan(Math.max(...before.tasks.map((t: { sortOrder: number }) => t.sortOrder)));
  expect(data.tasks.find((t: { id: string }) => t.id === "task_test_done")).toMatchObject({ sprintId: ids.sprintAlpha, status: "done" });
  expect(data.sprints.find((s: { id: string }) => s.id === nextId).status).toBe("planned");
  expect(data.workspace.backlogRevision).toBe(before.workspace.backlogRevision + 1);
  const after = await snapshot(db); expect((await mutate(context.request, payload)).status()).toBe(200); expect(await snapshot(db)).toEqual(after);
  expect(await db.collection("activities").countDocuments({ "event.type": "sprint.completed" })).toBe(1);
  expect((await mutate(context.request, end({ revision: 1 }))).status()).toBe(409);
});

test("phase9 editing or deleting returned work cannot rewrite the saved outcome", async ({ context, db }) => {
  await login(context); await mixed(db); await bootstrap(context.request); await mutate(context.request, end());
  const frozen = (await bootstrap(context.request)).sprints[0].outcome;
  expect((await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 1, title: "Otro título en backlog", points: null })).status()).toBe(200);
  expect((await mutate(context.request, { action: "deleteTask", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 2 })).status()).toBe(200);
  await db.collection("profiles").updateOne({ _id: users.owner.id as never }, { $set: { name: "Nombre cambiado después" } });
  await db.collection("workspaces").updateOne({ _id: ids.alpha as never }, { $set: { definitionOfDone: ["Otro acuerdo"] } });
  expect((await bootstrap(context.request)).sprints[0].outcome).toEqual(frozen);
});

test("phase9 cancelled and legacy completed sprints project without inventing snapshots", async ({ context, db }) => {
  await login(context); await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "completed" } });
  const before = await db.collection("sprints").findOne({ _id: ids.sprintAlpha as never });
  expect((await bootstrap(context.request)).sprints[0]).toMatchObject({ status: "completed", outcome: null });
  expect(await db.collection("sprints").findOne({ _id: ids.sprintAlpha as never })).toEqual(before);
  expect((await mutate(context.request, end())).status()).toBe(409);
});

test("phase9 closure validates review, summary, versions and active state atomically", async ({ context, db }) => {
  await login(context); await bootstrap(context.request); const before = await snapshot(db);
  for (const patch of [{ summary: " " }, { summary: 3 }, { summary: "x".repeat(2001) }, { reviewed: false }, { reviewed: "true" }, { revision: undefined }, { revision: -1 }, { governanceRevision: undefined }]) {
    expect((await mutate(context.request, end(patch))).status()).toBe(400); expect(await snapshot(db)).toEqual(before);
  }
  expect((await mutate(context.request, end({ revision: 1 }))).status()).toBe(409);
  expect((await mutate(context.request, end({ governanceRevision: 1 }))).status()).toBe(409);
  await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "planned" } });
  expect((await mutate(context.request, end())).status()).toBe(409);
});

test("phase9 cancellation requires a reason and administrative access, independently of Scrum responsibility", async ({ context, db }) => {
  await login(context, users.member); await bootstrap(context.request);
  await db.collection("workspaces").updateOne({ _id: ids.alpha as never }, { $set: { productOwnerId: users.member.id } });
  const before = await snapshot(db);
  expect((await mutate(context.request, end({ action: "cancelSprint", reason: "El objetivo dejó de ser útil" }))).status()).toBe(403);
  expect(await snapshot(db)).toEqual(before);
  await db.collection("memberships").updateOne({ workspaceId: ids.alpha, userId: users.member.id }, { $set: { role: "admin" } });
  for (const reason of ["", " ", 8, "x".repeat(1001)]) expect((await mutate(context.request, end({ action: "cancelSprint", reason }))).status()).toBe(400);
  const payload = end({ action: "cancelSprint", reason: "El objetivo dejó de ser útil", mutationId: crypto.randomUUID() });
  expect((await mutate(context.request, payload)).status()).toBe(200);
  expect((await bootstrap(context.request)).sprints[0]).toMatchObject({ status: "cancelled", outcome: { kind: "cancelled", reason: "El objetivo dejó de ser útil" } });
  const cancelled = await snapshot(db); expect((await mutate(context.request, payload)).status()).toBe(200); expect(await snapshot(db)).toEqual(cancelled);
  await db.collection("memberships").updateOne({ workspaceId: ids.alpha, userId: users.member.id }, { $set: { role: "member" } });
  expect((await mutate(context.request, payload)).status()).toBe(403);
});

test("phase9 member can close an empty active sprint and administrator can cancel a plan", async ({ context, db }) => {
  await login(context, users.member); await db.collection("tasks").deleteOne({ _id: ids.taskAlpha as never });
  expect((await mutate(context.request, end())).status()).toBe(200);
  expect((await bootstrap(context.request)).sprints[0].outcome.tasks).toEqual([]);
  await login(context); const created = await mutate(context.request, { action: "createSprint", workspaceId: ids.alpha, name: "Plan descartado" });
  expect((await mutate(context.request, end({ action: "cancelSprint", id: (await created.json()).sprintId, reason: "Cambio de enfoque" }))).status()).toBe(200);
});

test("phase9 outsiders and cross-project ids cannot end or retrieve sprint history", async ({ context, db }) => {
  await login(context); await bootstrap(context.request); const before = await snapshot(db);
  expect((await mutate(context.request, end({ id: ids.sprintBeta }))).status()).toBe(400);
  expect((await mutate(context.request, end({ workspaceId: ids.beta, id: ids.sprintBeta }))).status()).toBe(403);
  expect(await snapshot(db)).toEqual(before);
  await mutate(context.request, end()); await login(context, users.outsider);
  expect((await context.request.get(`/api/bootstrap?workspace=${ids.alpha}`)).status()).toBe(404);
});

for (const action of ["closeSprint", "cancelSprint"]) {
  test(`phase9 ${action} rolls back snapshot, returned work, locks and receipts on audit failure`, async ({ context, db }) => {
    await login(context); await mixed(db); await bootstrap(context.request); const before = await snapshot(db);
    await db.command({ collMod: "activities", validator: { "event.type": { $exists: false } }, validationLevel: "strict", validationAction: "error" });
    try { expect((await mutate(context.request, end({ action, reason: "Nueva dirección" }))).status()).toBe(500); expect(await snapshot(db)).toEqual(before); }
    finally { await db.command({ collMod: "activities", validator: {}, validationLevel: "off" }); }
  });
}

test("phase9 stale task edits and changed agreements invalidate an end confirmation", async ({ context, db }) => {
  await login(context); await bootstrap(context.request);
  expect((await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, title: "Cambió el resultado", status: "done" })).status()).toBe(200);
  const before = await snapshot(db); expect((await mutate(context.request, end())).status()).toBe(409); expect(await snapshot(db)).toEqual(before);
  await db.collection("workspaces").updateOne({ _id: ids.alpha as never }, { $set: { governanceRevision: 1 } });
  expect((await mutate(context.request, end({ revision: 1 }))).status()).toBe(409);
  expect((await mutate(context.request, end({ revision: 1, governanceRevision: 1 }))).status()).toBe(200);
});

test("phase9 concurrent close and cancel commit only one outcome", async ({ context, db }) => {
  await login(context); await mixed(db);
  const responses = await Promise.all([mutate(context.request, end()), mutate(context.request, end({ action: "cancelSprint", reason: "Objetivo obsoleto" }))]);
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
  expect(await db.collection("activities").countDocuments({ "event.type": { $in: ["sprint.completed", "sprint.cancelled"] } })).toBe(1);
  expect(await db.collection("tasks").findOne({ _id: ids.taskAlpha as never })).toMatchObject({ status: "backlog", revision: 1 });
});

test("phase9 concurrent task content edit cannot be silently omitted from closure", async ({ context }) => {
  await login(context);
  const responses = await Promise.all([mutate(context.request, end()), mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, title: "Resultado actualizado" })]);
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
});

test("phase9 all mutation paths refuse new work or edits in a finished sprint", async ({ context, db }) => {
  await login(context); await mixed(db); await bootstrap(context.request); await mutate(context.request, end()); const before = await snapshot(db);
  for (const payload of [
    { action: "createTask", title: "Trabajo indebido", sprintId: ids.sprintAlpha, status: "todo" },
    { action: "updateTask", id: "task_test_backlog", sprintId: ids.sprintAlpha, status: "todo" },
    { action: "updateTask", id: "task_test_done", title: "Reescribir resultado" },
    { action: "updateTask", id: "task_test_done", sprintId: null, status: "backlog" },
    { action: "deleteTask", id: "task_test_done" },
    { action: "updateSprint", id: ids.sprintAlpha, revision: 1, name: "Otro nombre" },
    { action: "startSprint", id: ids.sprintAlpha, revision: 1 },
  ]) { expect((await mutate(context.request, { workspaceId: ids.alpha, ...payload })).status()).toBe(409); expect(await snapshot(db)).toEqual(before); }
});

test("phase9 complete plan-start-close-next-start round trip preserves all tasks", async ({ context }) => {
  await login(context); await mutate(context.request, end());
  const created = await mutate(context.request, { action: "createSprint", workspaceId: ids.alpha, name: "Siguiente incremento", goal: "Mejorar la entrega" });
  const id = (await created.json()).sprintId;
  expect((await mutate(context.request, { action: "updateSprint", workspaceId: ids.alpha, id, revision: 0, taskChanges: [{ id: ids.taskAlpha, revision: 1, selected: true }] })).status()).toBe(200);
  expect((await mutate(context.request, { action: "startSprint", workspaceId: ids.alpha, id, revision: 1 })).status()).toBe(200);
  const data = await bootstrap(context.request); expect(data.sprints.filter((s: { status: string }) => s.status === "active")).toHaveLength(1);
  expect(data.tasks.find((t: { id: string }) => t.id === ids.taskAlpha)).toMatchObject({ sprintId: id, status: "todo" });
  expect(data.sprints.find((s: { id: string }) => s.id === ids.sprintAlpha).outcome.tasks[0]).toMatchObject({ id: ids.taskAlpha, status: "todo", returnedToBacklog: true });
});

test("phase9 UI closes, reloads history, filters snapshots and keeps completed tasks read-only", async ({ page, context, db }) => {
  await mixed(db); await login(context); await page.goto("/");
  await page.getByRole("button", { name: "Cerrar sprint", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Cerrar sprint", exact: true });
  await expect(dialog.getByRole("button", { name: "Confirmar cierre" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Resumen del resultado" }).fill("Resultado revisado con el equipo");
  await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Confirmar cierre" }).click(); await expect(dialog).toHaveCount(0);
  const archive = page.getByRole("region", { name: "Resultado histórico del sprint" }); await expect(archive).toContainText("Resultado revisado con el equipo");
  await expect(page.getByRole("region", { name: "Tablero Scrum" })).toHaveCount(0);
  await page.reload(); await expect(archive).toBeVisible();
  await archive.getByLabel("Mostrar trabajo histórico").selectOption("returned"); await expect(archive).toContainText("Preparar entrevista Alfa"); await expect(archive).not.toContainText("Resultado ya entregado");
  await page.getByRole("button", { name: "Historial de sprints" }).click(); const history = page.getByRole("dialog", { name: "Historial de sprints" });
  await history.getByRole("button", { name: "Ver historial de Sprint Alfa" }).click(); await expect(history).toHaveCount(0);
  await page.goto(`/?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&task=task_test_done`);
  const task = page.getByRole("dialog", { name: "UNI-03", exact: true }); await expect(task).toContainText("solo lectura"); await expect(task.getByRole("button", { name: "Guardar cambios" })).toHaveCount(0);
});

test("phase9 UI cancellation is distinct and its permission is reflected in controls", async ({ page, context }) => {
  await login(context, users.member); await page.goto("/"); await expect(page.getByRole("button", { name: "Cancelar sprint", exact: true })).toHaveCount(0);
  await login(context); await page.reload(); await page.getByRole("button", { name: "Cancelar sprint", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cancelar sprint", exact: true });
  await dialog.getByRole("textbox", { name: "Motivo de cancelación" }).fill("El objetivo cambió con el cliente"); await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Confirmar cancelación" }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Resultado histórico del sprint" })).toContainText("El objetivo cambió con el cliente");
  await page.getByRole("button", { name: "Historial de sprints" }).click(); const history = page.getByRole("dialog", { name: "Historial de sprints" }); await history.getByLabel("Resultado", { exact: true }).selectOption("completed");
  await expect(history).toContainText("No hay sprints que coincidan"); await history.getByLabel("Resultado", { exact: true }).selectOption("cancelled"); await expect(history.getByRole("button", { name: "Ver historial de Sprint Alfa" })).toBeVisible();
});

test("phase9 end conflict preserves text until explicit review of the current result", async ({ page, context }) => {
  await login(context); await page.goto("/"); await page.getByRole("button", { name: "Cerrar sprint", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cerrar sprint", exact: true }); await dialog.getByRole("textbox", { name: "Resumen del resultado" }).fill("Mi texto conservado"); await dialog.getByRole("checkbox").check();
  await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, status: "done" });
  await dialog.getByRole("button", { name: "Confirmar cierre" }).click(); await expect(dialog.getByRole("alert")).toContainText("cambiaron");
  await expect(dialog.getByRole("textbox", { name: "Resumen del resultado" })).toHaveValue("Mi texto conservado");
  await dialog.getByRole("button", { name: "Revisar versión actual" }).click(); await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Confirmar cierre" }).click(); await expect(dialog).toHaveCount(0);
});

test("phase9 lost closure response retries after reload without duplicate history or backlog transfers", async ({ page, context, db }) => {
  await login(context); await page.goto("/"); const keys: string[] = [];
  await page.route("**/api/mutate", async (route) => { keys.push(route.request().postDataJSON().mutationId); if (keys.length === 1) { await route.fetch(); await route.abort("failed"); } else await route.continue(); });
  await page.getByRole("button", { name: "Cerrar sprint", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Cerrar sprint", exact: true });
  await dialog.getByRole("textbox", { name: "Resumen del resultado" }).fill("Cierre compartido"); await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Confirmar cierre" }).click();
  await expect(dialog.getByRole("alert")).toContainText("No pudimos confirmar"); page.on("dialog", (warning) => warning.accept()); await page.reload();
  await page.getByLabel("Estado de sincronización").getByRole("button", { name: "Reintentar cambio pendiente" }).click(); await expect(page.getByLabel("Estado de sincronización")).toContainText("Actualizado");
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); expect(await db.collection("activities").countDocuments({ "event.type": "sprint.completed" })).toBe(1);
  expect(await db.collection("tasks").findOne({ _id: ids.taskAlpha as never })).toMatchObject({ revision: 1, status: "backlog" });
});

test("phase9 closing remotely preserves an open completed-task draft for copying", async ({ page, context, db }) => {
  await mixed(db); await login(context); await page.goto(`/?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&task=task_test_done`);
  const dialog = page.getByRole("dialog", { name: "UNI-03", exact: true });
  await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Mi propuesta sin guardar");
  expect((await mutate(context.request, end())).status()).toBe(200);
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog).toContainText("solo lectura"); await dialog.getByText("Ver borrador sin guardar", { exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Mi propuesta sin guardar" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copiar borrador", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Guardar cambios" })).toHaveCount(0);
});

for (const width of [320, 390, 1107]) {
  test(`phase9 neumorphic closure and archive fit ${width}px with large text`, async ({ page, context, db }) => {
    await mixed(db); await login(context); await page.setViewportSize({ width, height: 958 });
    await page.clock.setFixedTime(new Date("2026-10-21T15:00:00.000Z"));
    await page.addInitScript((light) => { localStorage.setItem("sprintia-theme", light ? "light" : "dark"); localStorage.setItem("sprintia-text-size", "xlarge"); }, width === 390);
    await page.goto("/"); await page.getByRole("button", { name: "Cerrar sprint", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cerrar sprint", exact: true }); await dialog.getByRole("textbox", { name: "Resumen del resultado" }).fill("Avance revisado con el equipo");
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await dialog.evaluate((el) => { el.scrollTop = 0; });
    await expect(page).toHaveScreenshot(`phase-9-close-${width}.png`, { animations: "disabled", caret: "hide", stylePath: "tests/e2e/screenshot.css" });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.getByRole("button", { name: "Cerrar sprint", exact: true })).toBeFocused();
    await page.emulateMedia({ reducedMotion: "reduce" }); await page.getByRole("button", { name: "Historial de sprints" }).click(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
    await mutate(context.request, end());
    await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { "outcome.endedAt": "2026-10-21T15:00:00.000Z" } });
    await page.reload(); await expect(page.getByRole("region", { name: "Resultado histórico del sprint" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`phase-9-archive-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
  });
}
