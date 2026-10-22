import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";
import type { APIRequestContext, Page } from "@playwright/test";

const backlogId = "task_test_backlog";
const change = (patch: Record<string, unknown> = {}) => ({ action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, ...patch });
const create = (patch: Record<string, unknown> = {}) => ({ action: "createTask", workspaceId: ids.alpha, title: "Historia nueva", status: "backlog", ...patch });
const reorder = (id: string, beforeId: string | null, backlogRevision: number) => ({ action: "reorderBacklog", workspaceId: ids.alpha, id, beforeId, backlogRevision });
const bootstrap = async (request: APIRequestContext) => (await request.get(`/api/bootstrap?workspace=${ids.alpha}`)).json();
async function addTwo(request: APIRequestContext) {
  const first = await mutate(request, create({ title: "Primera idea" }));
  const second = await mutate(request, create({ title: "Segunda idea" }));
  expect(first.status()).toBe(200); expect(second.status()).toBe(200);
  return [(await first.json()).taskId as string, (await second.json()).taskId as string];
}
async function openDetail(page: Page) {
  await page.goto(`/?workspace=${ids.alpha}&task=${ids.taskAlpha}`);
  return page.getByRole("dialog", { name: "UNI-01", exact: true });
}

test("phase7 legacy data has empty details and a zero order revision without a write migration", async ({ context, db }) => {
  await login(context);
  const data = await bootstrap(context.request);
  expect(data.workspace.backlogRevision).toBe(0);
  expect(data.tasks[0]).toMatchObject({ acceptanceCriteria: [], checklist: [], points: 3 });
  expect(await db.collection("tasks").countDocuments({ acceptanceCriteria: { $exists: true } })).toBe(0);
  expect(await db.collection("activities").countDocuments()).toBe(0);
});

test("phase7 details, optional estimates and no-op arrays are shared without changing Definition of Done", async ({ context, browser, db }) => {
  await login(context);
  const data = await bootstrap(context.request);
  const checklist = [{ id: "step_one", text: "Revisar referencias", done: true }];
  const criteria = ["El resultado es legible", "El enlace funciona"];
  expect((await mutate(context.request, change({ description: "Contexto\n\n- Paso uno\n- Paso dos", acceptanceCriteria: criteria, checklist, points: null }))).status()).toBe(200);
  const second = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try {
    await login(second, users.member);
    const shared = await bootstrap(second.request);
    expect(shared.tasks.find((task: { id: string }) => task.id === ids.taskAlpha)).toMatchObject({ acceptanceCriteria: criteria, checklist, points: null, status: "todo", revision: 1 });
    expect(shared.workspace.definitionOfDone).toEqual(data.workspace.definitionOfDone);
  } finally { await second.close(); }
  expect((await mutate(context.request, change({ revision: 1, acceptanceCriteria: criteria, checklist }))).status()).toBe(200);
  expect(await db.collection("activities").countDocuments()).toBe(1);
  expect((await mutate(context.request, change({ revision: 1, points: 8, checklist: [], acceptanceCriteria: [] }))).status()).toBe(200);
  expect((await mutate(context.request, create())).status()).toBe(200);
  expect(await db.collection("tasks").findOne({ title: "Historia nueva" })).toMatchObject({ points: null, checklist: [], acceptanceCriteria: [] });
});

test("phase7 rejects invalid criteria, checklist and estimates atomically", async ({ context, db }) => {
  await login(context); await bootstrap(context.request);
  const before = await snapshot(db);
  for (const patch of [
    { acceptanceCriteria: "incorrecto" }, { acceptanceCriteria: [""] }, { acceptanceCriteria: Array(21).fill("c") }, { acceptanceCriteria: ["x".repeat(241)] },
    { checklist: [{ id: "a", text: "paso", done: "true" }] }, { checklist: [{ id: "a", text: "", done: false }] },
    { checklist: [{ id: "a", text: "paso", done: false }, { id: "a", text: "otro", done: true }] },
    { checklist: Array.from({ length: 31 }, (_, i) => ({ id: String(i), text: "paso", done: false })) },
    { points: "5" }, { points: 0 }, { points: -1 }, { description: "x".repeat(1201) },
  ]) {
    expect((await mutate(context.request, change(patch))).status()).toBe(400);
    expect((await mutate(context.request, create(patch))).status()).toBe(400);
  }
  expect(await snapshot(db)).toEqual(before);
});

test("phase7 order persists, retries once and has a revision independent of task content", async ({ context, browser, db }) => {
  await login(context); const [first, second] = await addTwo(context.request);
  const payload = { ...reorder(second, backlogId, 2), mutationId: crypto.randomUUID() };
  expect((await mutate(context.request, payload)).status()).toBe(200);
  expect((await mutate(context.request, payload)).status()).toBe(200);
  const shared = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try {
    await login(shared, users.member);
    const data = await bootstrap(shared.request);
    expect(data.tasks.filter((t: { status: string }) => t.status === "backlog").map((t: { id: string }) => t.id)).toEqual([second, backlogId, first]);
    expect(data.workspace.backlogRevision).toBe(3);
    expect(data.tasks.find((t: { id: string }) => t.id === second).revision).toBe(0);
  } finally { await shared.close(); }
  expect(await db.collection("activities").countDocuments({ "event.type": "backlog.reordered" })).toBe(1);
  const event = await db.collection("activities").findOne({ "event.type": "backlog.reordered" });
  expect(event?.event.changes.order).toEqual({ before: [backlogId, first, second], after: [second, backlogId, first] });
  // Explicit numeric ranks cannot override the shared order.
  expect((await mutate(context.request, change({ id: second, sortOrder: -999 }))).status()).toBe(200);
  expect((await bootstrap(context.request)).tasks.find((t: { id: string }) => t.id === second).sortOrder).toBe(0);
});

test("phase7 reorder races, append and transfer reject a stale list instead of losing entries", async ({ context, db }) => {
  await login(context); const [first, second] = await addTwo(context.request);
  const results = await Promise.all([mutate(context.request, reorder(second, backlogId, 2)), mutate(context.request, reorder(first, backlogId, 2))]);
  expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
  expect((await mutate(context.request, create({ title: "Última idea", sortOrder: -999 }))).status()).toBe(200);
  let data = await bootstrap(context.request);
  expect(data.tasks.filter((t: { status: string }) => t.status === "backlog").at(-1).title).toBe("Última idea");
  expect((await mutate(context.request, reorder(second, null, 3))).status()).toBe(409);
  expect((await mutate(context.request, change({ id: first, sprintId: ids.sprintAlpha, status: "todo" }))).status()).toBe(200);
  expect((await mutate(context.request, reorder(second, null, 4))).status()).toBe(409);
  expect((await mutate(context.request, change({ id: first, revision: 1, status: "backlog" }))).status()).toBe(200);
  data = await bootstrap(context.request);
  expect(data.tasks.filter((t: { status: string }) => t.status === "backlog").at(-1).id).toBe(first);
  expect(await db.collection("tasks").countDocuments({ workspaceId: ids.alpha })).toBe(5);
});

test("phase7 order cannot cross project boundaries or accept malformed revisions", async ({ context, browser, db }) => {
  await login(context); const [first] = await addTwo(context.request); await bootstrap(context.request);
  const before = await snapshot(db);
  for (const patch of [{ id: ids.taskBeta }, { beforeId: ids.taskBeta }, { id: ids.taskAlpha }, { beforeId: undefined }, { backlogRevision: -1 }, { backlogRevision: "2" }]) {
    expect((await mutate(context.request, { ...reorder(first, backlogId, 2), ...patch })).status()).toBe(400);
  }
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try { await login(other, users.outsider); expect((await mutate(other.request, reorder(first, backlogId, 2))).status()).toBe(403); } finally { await other.close(); }
  expect(await snapshot(db)).toEqual(before);
});

test("phase7 failed order audit rolls back all ranks and the workspace revision", async ({ context, db }) => {
  await login(context); const [, second] = await addTwo(context.request); await bootstrap(context.request);
  const before = await snapshot(db);
  await db.command({ collMod: "activities", validator: { "event.type": { $ne: "backlog.reordered" } }, validationAction: "error" });
  try { expect((await mutate(context.request, reorder(second, backlogId, 2))).status()).toBe(500); } finally { await db.command({ collMod: "activities", validator: {} }); }
  expect(await snapshot(db)).toEqual(before);
});

test("phase7 backlog can be reordered by keys, mouse and accessible position buttons", async ({ page, context }) => {
  await login(context); const [first, second] = await addTwo(context.request);
  await page.goto(`/?workspace=${ids.alpha}&view=backlog`);
  const list = page.getByRole("list", { name: "Backlog ordenado" });
  const order = () => list.locator(":scope > li").evaluateAll((items) => items.map((item) => item.getAttribute("data-task-id")));
  const handle = page.getByRole("button", { name: "Reordenar UNI-04", exact: true });
  await handle.press("Home"); await expect.poll(order).toEqual([second, backlogId, first]); await expect(handle).toBeFocused();
  await handle.press("ArrowDown"); await expect.poll(order).toEqual([backlogId, second, first]);
  await handle.press("End"); await expect.poll(order).toEqual([backlogId, first, second]);
  await handle.dragTo(list.locator(":scope > li").first()); await expect.poll(order).toEqual([second, backlogId, first]);
  await page.getByRole("button", { name: "Bajar UNI-04", exact: true }).click(); await expect.poll(order).toEqual([backlogId, second, first]);
  await page.reload(); await expect.poll(order).toEqual([backlogId, second, first]);
  await list.locator(`[data-task-id="${second}"]`).getByRole("button", { name: "Añadir al sprint" }).click();
  await expect.poll(order).toEqual([backlogId, first]);
});

test("phase7 task editor saves criteria, checklist and unestimated state without completing the task", async ({ page, context, db }) => {
  await login(context); const dialog = await openDetail(page);
  await dialog.getByText("Criterios de aceptación · 0", { exact: true }).click();
  await dialog.getByRole("button", { name: "+ Añadir criterio" }).click();
  await dialog.getByRole("textbox", { name: "Criterio de aceptación 1", exact: true }).fill("El usuario puede leer el resultado");
  await dialog.getByText("Checklist · 0/0", { exact: true }).click();
  await dialog.getByRole("button", { name: "+ Añadir paso" }).click();
  await dialog.getByRole("textbox", { name: "Paso 1", exact: true }).fill("Preparar preguntas");
  await dialog.getByRole("checkbox", { name: "Completar paso 1" }).check();
  await dialog.getByRole("combobox", { name: "Puntos", exact: true }).selectOption("");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click(); await expect(dialog).toHaveCount(0);
  expect(await db.collection("tasks").findOne({ _id: ids.taskAlpha as never })).toMatchObject({ acceptanceCriteria: ["El usuario puede leer el resultado"], checklist: [{ text: "Preparar preguntas", done: true }], points: null, status: "todo" });
  await page.reload(); await page.getByRole("article", { name: /^UNI-01:/ }).click();
  await expect(dialog.getByRole("combobox", { name: "Puntos", exact: true })).toHaveValue("");
  await expect(dialog.getByText("Checklist · 1/1", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Criterios de aceptación · 1", { exact: true })).toBeVisible();
});

test("phase7 drafts survive close and reload, remain scoped, and clear only after a confirmed save", async ({ page, context }) => {
  await login(context); const dialog = await openDetail(page);
  await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Borrador privado de Ana");
  await dialog.getByRole("textbox", { name: "Descripción", exact: true }).fill("Párrafo\n\n- Un paso\n- Otro paso");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.reload(); await page.getByRole("article", { name: /^UNI-01:/ }).click();
  await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Borrador privado de Ana");
  await expect(dialog.getByText("Borrador recuperado de esta pestaña.")).toBeVisible();
  await login(context, users.member); await page.reload();
  await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Preparar entrevista Alfa");
  await login(context); await page.goto(`/?workspace=${ids.gamma}&task=${ids.taskGamma}`);
  await expect(page.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Preparar informe Gamma");
  await openDetail(page);
  await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Borrador privado de Ana");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click(); await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("sprintia-task-draft-v1:")))).toEqual([]);
});

test("phase7 rejected save keeps a recoverable draft after reload", async ({ page, context }) => {
  await login(context); const dialog = await openDetail(page);
  await dialog.getByRole("textbox", { name: "Descripción", exact: true }).fill("Conservar si falla el guardado");
  await page.route("**/api/mutate", (route) => route.fulfill({ status: 400, json: { error: "Validación de prueba" } }));
  await dialog.getByRole("button", { name: "Guardar cambios" }).click(); await expect(dialog.getByRole("alert")).toContainText("Validación de prueba");
  await page.reload(); await expect(dialog.getByRole("textbox", { name: "Descripción", exact: true })).toHaveValue("Conservar si falla el guardado");
  await dialog.getByRole("button", { name: "Descartar borrador" }).click();
  await expect(dialog.getByRole("textbox", { name: "Descripción", exact: true })).toHaveValue("Documentar el objetivo y compartir los resultados con el equipo.");
});

test("phase7 moving a card never discards an unfinished editor draft", async ({ page, context }) => {
  await login(context); const dialog = await openDetail(page);
  await dialog.getByRole("textbox", { name: "Descripción", exact: true }).fill("Notas sin guardar antes de mover");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); await expect(dialog).toHaveCount(0);
  const card = page.getByRole("article", { name: /^UNI-01:/ });
  await card.getByRole("combobox", { name: "Mover UNI-01", exact: true }).selectOption("progress");
  await expect(page.getByLabel("Estado de sincronización")).toContainText("Actualizado");
  await page.reload(); await card.click();
  await expect(dialog.getByRole("textbox", { name: "Descripción", exact: true })).toHaveValue("Notas sin guardar antes de mover");
  await expect(dialog.getByLabel("Conflicto de tarea")).toBeVisible();
});

test("phase7 stale reorder refreshes the shared list and reduced motion skips movement", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(context); const [, second] = await addTwo(context.request);
  await page.goto(`/?workspace=${ids.alpha}&view=backlog`);
  const handle = page.getByRole("button", { name: "Reordenar UNI-04", exact: true });
  await expect(handle).toBeVisible();
  expect((await mutate(context.request, reorder(second, backlogId, 2))).status()).toBe(200);
  await handle.press("Home");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("El orden del backlog cambió");
  await expect(page.getByRole("list", { name: "Backlog ordenado" }).locator(":scope > li").first()).toHaveAttribute("data-task-id", second);
  await expect(handle).toBeEnabled(); await handle.press("End");
  await expect(page.getByRole("list", { name: "Backlog ordenado" }).locator(":scope > li").last()).toHaveAttribute("data-task-id", second);
  expect(await page.getByRole("list", { name: "Backlog ordenado" }).evaluate((el) => el.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length)).toBe(0);
});

test("phase7 malformed draft data is ignored and missing estimates are clearly labeled", async ({ page, context }) => {
  await login(context); await mutate(context.request, change({ points: null }));
  await page.addInitScript(({ actor, workspace, task }) => {
    sessionStorage.setItem(`sprintia-task-draft-v1:${actor}:${workspace}:${task}`, JSON.stringify({ version: 1, form: { title: "not a valid draft" } }));
  }, { actor: users.owner.id, workspace: ids.alpha, task: ids.taskAlpha });
  const dialog = await openDetail(page);
  await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Preparar entrevista Alfa");
  await expect(dialog.getByRole("combobox", { name: "Puntos", exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("article", { name: /^UNI-01:/ }).getByLabel("Sin estimar", { exact: true })).toBeVisible();
  await expect(page.locator(".column-todo")).toContainText("0 pts · 1 sin estimar");
});

test("phase7 an uncertain create survives reload and retries its original key, not another task", async ({ page, context, db }) => {
  await login(context); await page.goto("/"); const keys: string[] = [];
  await page.route("**/api/mutate", async (route) => {
    keys.push(route.request().postDataJSON().mutationId);
    if (keys.length === 1) { await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  await page.getByRole("button", { name: "+ Nueva tarea", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva tarea" });
  await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Creación recuperable");
  await dialog.getByRole("button", { name: "Crear tarea", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("No pudimos confirmar");
  page.on("dialog", (warning) => warning.accept());
  await page.reload();
  await page.getByLabel("Estado de sincronización").getByRole("button", { name: "Reintentar cambio pendiente" }).click();
  await expect(page.getByLabel("Estado de sincronización")).toContainText("Actualizado");
  expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
  expect(await db.collection("tasks").countDocuments({ title: "Creación recuperable" })).toBe(1);
  await page.getByRole("button", { name: "+ Nueva tarea", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("");
});

test("phase7 restored drafts retain the old baseline and reveal concurrent changes", async ({ page, context }) => {
  await login(context); const dialog = await openDetail(page);
  await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Mi edición sin enviar");
  await mutate(context.request, change({ title: "La edición de Bruno", acceptanceCriteria: ["Criterio compartido"] }));
  await page.reload();
  await expect(dialog.getByLabel("Conflicto de tarea")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Mi edición sin enviar");
  await dialog.getByText("Comparar con la versión actual").click(); await expect(dialog.getByText("Criterio compartido", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
});

test("phase7 blocked storage retains an in-memory draft and reports the limitation", async ({ page, context }) => {
  await login(context); const dialog = await openDetail(page);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("QuotaExceededError"); }; });
  await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Borrador sin almacenamiento");
  await expect(dialog.getByText(/No se pudo guardar el borrador/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole("article", { name: /^UNI-01:/ }).click();
  await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Borrador sin almacenamiento");
});

test("phase7 compact editor formats paragraphs, lists and safe links without interpreting HTML", async ({ page, context }) => {
  await login(context); const dialog = await openDetail(page);
  const description = dialog.getByRole("textbox", { name: "Descripción", exact: true });
  await description.fill("Primero\nSegundo"); await description.press("Control+A");
  await dialog.getByRole("button", { name: "Lista", exact: true }).click(); await expect(description).toHaveValue("- Primero\n- Segundo");
  await description.press("Control+End"); await dialog.getByRole("button", { name: "Párrafo", exact: true }).click();
  await dialog.getByRole("button", { name: "Enlace", exact: true }).click();
  await dialog.getByLabel("Texto del enlace", { exact: true }).fill("Referencia"); await dialog.getByLabel("Dirección del enlace", { exact: true }).fill("javascript:alert(1)");
  await expect(dialog.getByRole("button", { name: "Insertar enlace" })).toBeDisabled();
  await dialog.getByLabel("Dirección del enlace", { exact: true }).fill("https://example.invalid/guia"); await dialog.getByRole("button", { name: "Insertar enlace" }).click();
  await dialog.getByText("Vista previa de descripción", { exact: true }).click();
  await expect(dialog.getByRole("link", { name: "Referencia" })).toHaveAttribute("href", "https://example.invalid/guia");
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await description.fill('<img src=x onerror=alert(1)>\n\n[Malicioso](javascript:alert)\n\n[Seguro](https://example.invalid)');
  await expect(dialog.locator("img")).toHaveCount(0); await expect(dialog.getByRole("link", { name: "Malicioso" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Seguro" })).toHaveAttribute("rel", "noopener noreferrer");
});

for (const width of [320, 390, 1107]) {
  test(`phase7 detail and backlog fit with large type at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 958 }); await page.clock.setFixedTime(new Date("2026-10-12T15:00:00.000Z"));
    await page.addInitScript((light) => { localStorage.setItem("sprintia-text-size", "xlarge"); localStorage.setItem("sprintia-theme", light ? "light" : "dark"); }, width === 390);
    await login(context); await addTwo(context.request); await page.goto(`/?workspace=${ids.alpha}&view=backlog`);
    await expect(page.getByRole("list", { name: "Backlog ordenado" })).toBeVisible(); await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`phase-7-backlog-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
    const dialog = await openDetail(page);
    await dialog.getByText("Criterios de aceptación · 0", { exact: true }).click(); await dialog.getByRole("button", { name: "+ Añadir criterio" }).click();
    await dialog.getByRole("textbox", { name: "Criterio de aceptación 1", exact: true }).fill("Resultado verificable de esta historia");
    await dialog.getByText("Checklist · 0/0", { exact: true }).click(); await dialog.getByRole("button", { name: "+ Añadir paso" }).click();
    await dialog.getByRole("textbox", { name: "Paso 1", exact: true }).fill("Compartir el resultado");
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const tinyText = await dialog.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("*")).filter((node) => node.getClientRects().length && Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) && Number.parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.textContent));
    expect(tinyText).toEqual([]);
    await dialog.evaluate((el) => { el.scrollTop = 0; }); await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`phase-7-detail-${width}.png`, { animations: "disabled", caret: "hide", stylePath: "tests/e2e/screenshot.css" });
    await page.addStyleTag({ path: "tests/e2e/screenshot.css" }); await page.screenshot({ path: testInfo.outputPath("review.png"), animations: "disabled" });
  });
}
