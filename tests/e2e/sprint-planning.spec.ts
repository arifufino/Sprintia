import type { APIRequestContext, Page } from "@playwright/test";
import type { Db } from "mongodb";
import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";

const backlogId = "task_test_backlog";
const bootstrap = async (request: APIRequestContext) => (await request.get(`/api/bootstrap?workspace=${ids.alpha}`)).json();
const plan = (patch: Record<string, unknown> = {}) => ({ action: "updateSprint", workspaceId: ids.alpha, id: ids.sprintAlpha, revision: 0, ...patch });
const start = (patch: Record<string, unknown> = {}) => ({ action: "startSprint", workspaceId: ids.alpha, id: ids.sprintAlpha, revision: 0, ...patch });
async function planned(db: Db) { await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "planned" } }); }
async function createPlan(request: APIRequestContext, name = "Sprint siguiente") {
  const response = await mutate(request, { action: "createSprint", workspaceId: ids.alpha, name, goal: "Validar un incremento útil", startDate: "2026-10-20", endDate: "2026-11-02" });
  expect(response.status()).toBe(200); return (await response.json()).sprintId as string;
}
async function openPlan(page: Page) {
  await page.goto(`/?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`);
  await page.getByRole("button", { name: "Planificar sprint", exact: true }).click();
  return page.getByRole("dialog", { name: "Planificar sprint", exact: true });
}

test("phase8 legacy fields are projected without rewriting existing active sprints", async ({ context, db }) => {
  await login(context); const data = await bootstrap(context.request);
  expect(data.sprints[0]).toMatchObject({ revision: 0, status: "active", availability: "", capacityHours: null, startedAt: null });
  expect(await db.collection("sprints").countDocuments({ availability: { $exists: true } })).toBe(0);
  expect(await db.collection("activities").countDocuments()).toBe(0);
  const first = await createPlan(context.request); const second = await createPlan(context.request, "Otro plan");
  expect(await db.collection("sprints").countDocuments({ _id: { $in: [first, second] as never }, status: "planned" })).toBe(2);
  expect(await db.collection("sprints").countDocuments({ workspaceId: ids.alpha, status: "active" })).toBe(1);
});

test("phase8 every new workspace and first sprint waits for explicit start", async ({ context, db }) => {
  await login(context);
  const response = await mutate(context.request, { action: "createWorkspace", name: "Proyecto nuevo" });
  expect(response.status()).toBe(200);
  expect(await db.collection("sprints").findOne({ workspaceId: (await response.json()).workspaceId })).toMatchObject({ status: "planned" });
  await db.collection("sprints").deleteOne({ _id: ids.sprintAlpha as never });
  const id = await createPlan(context.request);
  expect(await db.collection("sprints").findOne({ _id: id as never })).toMatchObject({ status: "planned" });
  await login(context, { id: "test_newcomer", name: "Nuevo integrante", email: "new@example.invalid" });
  const starter = await (await context.request.get("/api/bootstrap")).json();
  expect(starter.sprints[0].status).toBe("planned");
  expect(starter.tasks.every((task: { status: string }) => ["backlog", "todo"].includes(task.status))).toBe(true);
});

test("phase8 saves a shared plan, optional capacity and task selection in one idempotent event", async ({ context, browser, db }) => {
  await login(context); await planned(db);
  const payload = plan({ mutationId: crypto.randomUUID(), name: "Incremento de entrevistas", goal: "Validar dos hipótesis", availability: "Exámenes el jueves", capacityHours: 0,
    taskChanges: [{ id: backlogId, revision: 0, selected: true }, { id: ids.taskAlpha, revision: 0, selected: false }] });
  expect((await mutate(context.request, payload)).status()).toBe(200);
  const saved = await snapshot(db);
  expect((await mutate(context.request, payload)).status()).toBe(200); expect(await snapshot(db)).toEqual(saved);
  expect(await db.collection("sprints").findOne({ _id: ids.sprintAlpha as never })).toMatchObject({ revision: 1, status: "planned", capacityHours: 0, availability: "Exámenes el jueves" });
  expect(await db.collection("tasks").findOne({ _id: backlogId as never })).toMatchObject({ sprintId: ids.sprintAlpha, status: "todo", revision: 1 });
  expect(await db.collection("tasks").findOne({ _id: ids.taskAlpha as never })).toMatchObject({ sprintId: null, status: "backlog", revision: 1 });
  expect(await db.collection("workspaces").findOne({ _id: ids.alpha as never })).toMatchObject({ backlogRevision: 1 });
  const event = await db.collection("activities").findOne({ "event.type": "sprint.planned" });
  expect(event).toMatchObject({ actorName: users.owner.name, event: { entityId: ids.sprintAlpha, entityRevision: 1 } });
  expect(Object.keys(event!.event.changes.tasks.after).sort()).toEqual([ids.taskAlpha, backlogId].sort());
  expect((await mutate(context.request, plan({ revision: 1 }))).status()).toBe(200);
  expect(await db.collection("activities").countDocuments()).toBe(1);
  const second = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try { await login(second, users.member); expect((await bootstrap(second.request)).sprints[0]).toMatchObject({ name: "Incremento de entrevistas", capacityHours: 0 }); }
  finally { await second.close(); }
});

test("phase8 invalid plans, duplicate selections and cross-project references leave no effects", async ({ context, db }) => {
  await login(context); await planned(db); await bootstrap(context.request); const before = await snapshot(db);
  for (const patch of [{ name: "" }, { name: "x".repeat(81) }, { goal: "x".repeat(301) }, { availability: "x".repeat(1001) }, { capacityHours: -1 }, { capacityHours: "12" }, { capacityHours: 10001 },
    { startDate: "2026-02-30" }, { endDate: "2026-09-30" }, { startDate: 12 }, { endDate: "" }, { revision: undefined }, { revision: "0" }, { revision: -1 },
    { taskChanges: "bad" }, { taskChanges: Array(101).fill({ id: backlogId, revision: 0, selected: true }) }, { taskChanges: [{ id: backlogId, revision: 0, selected: "yes" }] },
    { taskChanges: [{ id: backlogId, revision: 0, selected: true }, { id: backlogId, revision: 0, selected: true }] }]) {
    expect((await mutate(context.request, plan(patch))).status(), JSON.stringify(patch).slice(0, 150)).toBe(400);
  }
  for (const id of [ids.taskBeta, ids.taskGamma, "task_missing"]) {
    expect((await mutate(context.request, plan({ taskChanges: [{ id, revision: 0, selected: true }] }))).status()).toBe(409);
  }
  expect(await snapshot(db)).toEqual(before);
});

test("phase8 only members can plan or start and no active/completed plan can be edited", async ({ context, db }) => {
  await login(context); await bootstrap(context.request); const before = await snapshot(db);
  expect((await mutate(context.request, plan({ name: "Cannot edit active" }))).status()).toBe(409);
  for (const payload of [plan({ workspaceId: ids.beta, id: ids.sprintBeta }), start({ workspaceId: ids.beta, id: ids.sprintBeta }), plan({ id: ids.sprintGamma }), start({ id: ids.sprintGamma })]) expect((await mutate(context.request, payload)).ok()).toBe(false);
  expect(await snapshot(db)).toEqual(before);
  await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "completed" } });
  expect((await mutate(context.request, plan())).status()).toBe(409); expect((await mutate(context.request, start())).status()).toBe(409);
  await planned(db); await login(context, users.member);
  expect((await mutate(context.request, plan({ availability: "Disponibilidad acordada" }))).status()).toBe(200);
  expect((await mutate(context.request, start({ revision: 1 }))).status()).toBe(200);
});

test("phase8 competing plan edits and stale task versions cannot overwrite a teammate", async ({ context, db }) => {
  await login(context); await planned(db);
  const results = await Promise.all([mutate(context.request, plan({ goal: "Primera opción" })), mutate(context.request, plan({ availability: "Segunda opción" }))]);
  expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
  expect((await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: backlogId, title: "Nueva idea compartida" })).status()).toBe(200);
  const before = await snapshot(db);
  expect((await mutate(context.request, plan({ revision: 1, goal: "No sobrescribir", taskChanges: [{ id: backlogId, revision: 0, selected: true }] }))).status()).toBe(409);
  expect(await snapshot(db)).toEqual(before);
});

test("phase8 all existing task paths invalidate stale sprint scope snapshots", async ({ context, db }) => {
  await login(context); await planned(db);
  const id = await createPlan(context.request);
  expect((await mutate(context.request, { action: "createTask", workspaceId: ids.alpha, sprintId: id, title: "Nueva selección" })).status()).toBe(200);
  expect((await mutate(context.request, plan({ id, revision: 0 }))).status()).toBe(409);
  expect((await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, sprintId: id })).status()).toBe(200);
  expect((await mutate(context.request, plan())).status()).toBe(409);
  expect((await mutate(context.request, start({ id, revision: 1 }))).status()).toBe(409);
  expect((await mutate(context.request, { action: "deleteTask", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 1 })).status()).toBe(200);
  expect((await mutate(context.request, start({ id, revision: 2 }))).status()).toBe(409);
  expect(await db.collection("sprints").findOne({ _id: id as never })).toMatchObject({ revision: 3 });
});

for (const action of ["updateSprint", "startSprint"]) {
  test(`phase8 ${action} rolls back plan, scope, locks and receipts if audit storage fails`, async ({ context, db }) => {
    await login(context); await planned(db); await bootstrap(context.request); const before = await snapshot(db);
    await db.command({ collMod: "activities", validator: { "event.type": { $exists: false } }, validationLevel: "strict", validationAction: "error" });
    try {
      expect((await mutate(context.request, plan({ action, taskChanges: [{ id: backlogId, revision: 0, selected: true }] }))).status()).toBe(500);
      expect(await snapshot(db)).toEqual(before);
    } finally { await db.command({ collMod: "activities", validator: {}, validationLevel: "off" }); }
  });
}

test("phase8 starting requires a goal and work, not points or capacity, and is idempotent", async ({ context, db }) => {
  await login(context); await planned(db);
  await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { goal: "" } });
  expect((await mutate(context.request, start())).status()).toBe(400);
  const id = await createPlan(context.request);
  expect((await mutate(context.request, start({ id }))).status()).toBe(400);
  expect((await mutate(context.request, plan({ id, capacityHours: 0, taskChanges: [{ id: backlogId, revision: 0, selected: true }] }))).status()).toBe(200);
  await db.collection("tasks").updateOne({ _id: backlogId as never }, { $set: { points: null } });
  const payload = start({ id, revision: 1, mutationId: crypto.randomUUID() });
  const results = await Promise.all([mutate(context.request, payload), mutate(context.request, payload)]);
  expect(results.map((r) => r.status())).toEqual([200, 200]);
  const before = await snapshot(db);
  expect((await mutate(context.request, payload)).status()).toBe(200); expect(await snapshot(db)).toEqual(before);
  const sprint = await db.collection("sprints").findOne({ _id: id as never });
  expect(sprint).toMatchObject({ status: "active", revision: 2, capacityHours: 0 }); expect(Number.isNaN(Date.parse(sprint!.startedAt))).toBe(false);
  expect(await db.collection("activities").countDocuments({ "event.type": "sprint.started" })).toBe(1);
});

test("phase8 two people starting different sprints concurrently can activate only one", async ({ context, browser, db }) => {
  await login(context); await planned(db);
  const id = await createPlan(context.request);
  expect((await mutate(context.request, plan({ id, taskChanges: [{ id: backlogId, revision: 0, selected: true }] }))).status()).toBe(200);
  const second = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try {
    await login(second, users.member);
    const results = await Promise.all([mutate(context.request, start()), mutate(second.request, start({ id, revision: 1 }))]);
    expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
    expect(await db.collection("sprints").countDocuments({ workspaceId: ids.alpha, status: "active" })).toBe(1);
    expect(await db.collection("sprints").countDocuments({ workspaceId: ids.alpha, status: "planned" })).toBe(1);
    expect(await db.collection("activities").countDocuments({ "event.type": "sprint.started" })).toBe(1);
  } finally { await second.close(); }
});

test("phase8 existing and legacy multiple active sprints block new starts without silently rewriting data", async ({ context, db }) => {
  await login(context); const id = await createPlan(context.request);
  await mutate(context.request, plan({ id, taskChanges: [{ id: backlogId, revision: 0, selected: true }] }));
  const before = await snapshot(db); expect((await mutate(context.request, start({ id, revision: 1 }))).status()).toBe(409); expect(await snapshot(db)).toEqual(before);
  const other = await createPlan(context.request, "Legacy duplicado");
  await db.collection("sprints").updateOne({ _id: other as never }, { $set: { status: "active" } });
  const duplicate = await snapshot(db); expect((await mutate(context.request, start({ id, revision: 1 }))).status()).toBe(409); expect(await snapshot(db)).toEqual(duplicate);
  expect((await bootstrap(context.request)).sprints).toHaveLength(3);
});

test("phase8 plan and start receipt replay rechecks current membership", async ({ context, db }) => {
  await login(context, users.member); await planned(db);
  const edit = plan({ goal: "Un objetivo compartido", mutationId: crypto.randomUUID() });
  const begin = start({ revision: 1, mutationId: crypto.randomUUID() });
  expect((await mutate(context.request, edit)).status()).toBe(200); expect((await mutate(context.request, begin)).status()).toBe(200);
  await db.collection("memberships").deleteOne({ workspaceId: ids.alpha, userId: users.member.id });
  expect((await mutate(context.request, edit)).status()).toBe(403); expect((await mutate(context.request, begin)).status()).toBe(403);
});

test("phase8 UI prepares and starts the chosen sprint, keeping other plans inactive after reload", async ({ page, context, db }) => {
  await login(context); await planned(db); await createPlan(context.request);
  const dialog = await openPlan(page);
  await dialog.getByRole("textbox", { name: "Objetivo", exact: true }).fill("Conseguir feedback verificable");
  await dialog.getByText("Disponibilidad del equipo · opcional", { exact: true }).click();
  await dialog.getByRole("textbox", { name: "Contexto de disponibilidad" }).fill("El equipo tiene exámenes");
  await dialog.getByRole("spinbutton", { name: "Horas disponibles del equipo" }).fill("12.5");
  await dialog.getByRole("checkbox", { name: /UNI-02/ }).check();
  await dialog.getByRole("button", { name: "Guardar planificación" }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Iniciar sprint", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Iniciar sprint", exact: true });
  await expect(confirmation).toContainText("2 tareas"); await expect(confirmation).toContainText("12.5 h de equipo");
  await confirmation.getByRole("button", { name: "Confirmar inicio" }).click(); await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Planificación del sprint" })).toHaveCount(0);
  await page.reload(); await expect(page.getByLabel("Sprint", { exact: true })).toHaveValue(ids.sprintAlpha);
  expect(await db.collection("sprints").countDocuments({ workspaceId: ids.alpha, status: "active" })).toBe(1);
  expect(await db.collection("sprints").countDocuments({ workspaceId: ids.alpha, status: "planned" })).toBe(1);
});

test("phase8 UI creates and switches among multiple plans without implying they started", async ({ page, context }) => {
  await login(context); await page.goto("/");
  await page.getByRole("button", { name: "+ Sprint", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Crear sprint" });
  await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("Plan para la tesis");
  await dialog.getByRole("button", { name: "Crear sprint", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Iniciar sprint", exact: true })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Planificación del sprint" })).toContainText("Sprint Alfa");
  const id = new URL(page.url()).searchParams.get("sprint")!;
  await page.getByLabel("Sprint", { exact: true }).selectOption(ids.sprintAlpha);
  await expect(page.getByRole("button", { name: "Planificar sprint", exact: true })).toHaveCount(0);
  await page.getByLabel("Sprint", { exact: true }).selectOption(id);
  await expect(page.getByRole("button", { name: "Planificar sprint", exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByLabel("Sprint", { exact: true })).toHaveValue(id);
});

test("phase8 plan conflict keeps edits until explicitly loading the current version", async ({ page, context, db }) => {
  await login(context); await planned(db); const dialog = await openPlan(page);
  await dialog.getByRole("textbox", { name: "Objetivo", exact: true }).fill("Mi propuesta sin guardar");
  await mutate(context.request, plan({ name: "Plan de Bruno" }));
  await dialog.getByRole("button", { name: "Guardar planificación" }).click();
  await expect(dialog.getByRole("alert")).toContainText("El sprint o su selección de trabajo cambió");
  await expect(dialog.getByRole("textbox", { name: "Objetivo", exact: true })).toHaveValue("Mi propuesta sin guardar");
  await expect(dialog.getByRole("button", { name: "Guardar planificación" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cargar versión actual y descartar mi formulario" }).click();
  await expect(dialog.getByRole("textbox", { name: "Nombre", exact: true })).toHaveValue("Plan de Bruno");
  await expect(dialog.getByRole("button", { name: "Guardar planificación" })).toBeEnabled();
});

test("phase8 losing a start response retries the original intent without duplicate start", async ({ page, context, db }) => {
  await login(context); await planned(db); await page.goto(`/?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`);
  const keys: string[] = [];
  await page.route("**/api/mutate", async (route) => { keys.push(route.request().postDataJSON().mutationId); if (keys.length === 1) { await route.fetch(); await route.abort("failed"); } else await route.continue(); });
  await page.getByRole("button", { name: "Iniciar sprint", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Iniciar sprint", exact: true });
  await dialog.getByRole("button", { name: "Confirmar inicio" }).click(); await expect(dialog.getByRole("alert")).toContainText("No pudimos confirmar");
  page.on("dialog", (warning) => warning.accept()); await page.reload();
  await page.getByLabel("Estado de sincronización").getByRole("button", { name: "Reintentar cambio pendiente" }).click();
  await expect(page.getByLabel("Estado de sincronización")).toContainText("Actualizado");
  expect(keys.length).toBe(2); expect(keys[0]).toBe(keys[1]); expect(await db.collection("activities").countDocuments({ "event.type": "sprint.started" })).toBe(1);
});

test("phase8 new dialogs close with motion and restore focus, with a reduced-motion alternative", async ({ page, context, db }) => {
  await login(context); await planned(db); await page.goto("/");
  for (const title of ["Planificar sprint", "Iniciar sprint"]) {
    const trigger = page.getByRole("button", { name: title, exact: true }); await trigger.click();
    const surface = page.locator(".modal-backdrop");
    await surface.evaluate((el) => { const observer = new MutationObserver(() => { if (el.getAttribute("data-motion") === "closing") { el.getAnimations({ subtree: true }).forEach((a) => a.pause()); observer.disconnect(); } }); observer.observe(el, { attributes: true, attributeFilter: ["data-motion"] }); });
    await page.keyboard.press("Escape"); await expect(surface).toHaveAttribute("data-motion", "closing");
    const count = await surface.evaluate((el) => { const animations = el.getAnimations({ subtree: true }); animations.forEach((a) => a.finish()); return animations.length; }); expect(count).toBeGreaterThan(0);
    await expect(page.getByRole("dialog")).toHaveCount(0); await expect(trigger).toBeFocused();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Planificar sprint", exact: true }).click(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const width of [320, 390, 1107]) {
  test(`phase8 planning fits at ${width}px with large text and keyboard controls`, async ({ page, context, db }, testInfo) => {
    await planned(db); await login(context); await page.setViewportSize({ width, height: 958 }); await page.clock.setFixedTime(new Date("2026-10-12T15:00:00.000Z"));
    await page.addInitScript((light) => { localStorage.setItem("sprintia-text-size", "xlarge"); localStorage.setItem("sprintia-theme", light ? "light" : "dark"); }, width === 390);
    await page.goto(`/?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`); await expect(page.getByRole("button", { name: "Planificar sprint", exact: true })).toBeVisible(); await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (width === 320) {
      const begin = (await page.getByRole("button", { name: "Iniciar sprint", exact: true }).boundingBox())!;
      const copilot = (await page.getByRole("button", { name: "Abrir copiloto de Sprintia", exact: true }).boundingBox())!;
      expect(begin.y + begin.height).toBeLessThanOrEqual(copilot.y);
    }
    await expect(page).toHaveScreenshot(`phase-8-board-planned-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
    await page.getByRole("button", { name: "Planificar sprint", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Planificar sprint" });
    await dialog.getByText("Disponibilidad del equipo · opcional", { exact: true }).click();
    const checkbox = dialog.getByRole("checkbox", { name: /UNI-02/ }); await checkbox.focus(); await checkbox.press("Space"); await expect(checkbox).toBeChecked();
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await dialog.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("*")).filter((node) => node.getClientRects().length && Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.textContent))).toEqual([]);
    await dialog.evaluate((el) => { el.scrollTop = 0; }); await expect.poll(() => dialog.evaluate((el) => el.scrollTop)).toBe(0);
    await expect(page).toHaveScreenshot(`phase-8-plan-${width}.png`, { animations: "disabled", caret: "hide", stylePath: "tests/e2e/screenshot.css" });
    await page.addStyleTag({ path: "tests/e2e/screenshot.css" }); await page.screenshot({ path: testInfo.outputPath("review.png"), animations: "disabled" });
  });
}
