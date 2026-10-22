import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";

const base = { workspaceId: ids.alpha, sprintId: ids.sprintAlpha };
const observation = (patch: Record<string, unknown> = {}) => ({ action: "addRetroObservation", ...base, kind: "problem", text: "Los accesos al laboratorio llegaron tarde", ...patch });
const actionFields = { title: "Preparar accesos antes de empezar", measure: "El equipo puede entrar al laboratorio el primer día", ownerId: users.member.id, targetSprintId: null };
const retro = async (request: APIRequestContext, extra = "", sprint = ids.sprintAlpha) => (await request.get(`/api/retro?workspace=${ids.alpha}&sprint=${sprint}${extra}`)).json();
const bootstrap = async (request: APIRequestContext) => (await request.get(`/api/bootstrap?workspace=${ids.alpha}`)).json();
async function selected(request: APIRequestContext) {
  expect((await mutate(request, observation())).status()).toBe(200);
  const row = (await retro(request)).observations.at(-1);
  expect((await mutate(request, { action: "selectRetroProblem", ...base, id: row.id, revision: row.revision, selected: true })).status()).toBe(200);
  return (await retro(request)).observations.find((item: { id: string }) => item.id === row.id);
}
const create = (row: { id: string; revision: number }, patch: Record<string, unknown> = {}) => ({ action: "createRetroAction", ...base, observationId: row.id, observationRevision: row.revision, ...actionFields, ...patch });
const update = (id: string, patch: Record<string, unknown> = {}) => ({ action: "updateRetroAction", ...base, id, revision: 0, ...actionFields, status: "progress", note: "Solicitamos los accesos con antelación", ...patch });
async function agreed(request: APIRequestContext) { const row = await selected(request); const response = await mutate(request, create(row)); expect(response.status()).toBe(200); return (await response.json()).retroActionId as string; }
async function open(page: Page) { await page.goto(`/?workspace=${ids.alpha}&view=retro&sprint=${ids.sprintAlpha}`); await expect(page.getByRole("button", { name: "Compartir observación", exact: true })).toBeVisible(); await expect(page.getByText("Observaciones y mejoras compartidas", { exact: true })).toBeVisible(); }
async function fillAction(page: Page) { const dialog = page.getByRole("dialog", { name: "Acordar una mejora", exact: true }); await dialog.getByLabel("Acción de mejora", { exact: true }).fill(actionFields.title); await dialog.getByLabel("Cómo comprobaremos la mejora", { exact: true }).fill(actionFields.measure); await dialog.getByLabel("Responsable de la mejora", { exact: true }).selectOption(users.member.id); return dialog; }
test.beforeEach(async ({ context }) => { await login(context); });

test("phase12 legacy projects expose an empty retrospectiva without fabricating history", async ({ context, db }) => {
  expect((await bootstrap(context.request)).workspace.retroRevision).toBe(0);
  const before = await snapshot(db); expect(await retro(context.request)).toEqual({ observations: [], actions: [], nextCursor: null, counts: { open: 0, progress: 0, done: 0, dropped: 0 } }); expect(await snapshot(db)).toEqual(before);
});

test("phase12 observations, selected problems and concrete actions persist without changing sprint work", async ({ context, db }) => {
  const before = await bootstrap(context.request), row = await selected(context.request), payload = create(row, { ownerName: "Forged", sprintName: "Forged", observation: "Forged", status: "done" });
  const response = await mutate(context.request, payload); expect(response.status()).toBe(200); const id = (await response.json()).retroActionId;
  const data = await retro(context.request); expect(data.observations[0]).toMatchObject({ selected: true, actionId: id, revision: 2 });
  expect(data.actions[0]).toMatchObject({ id, status: "open", ownerName: users.member.name, sprintName: "Sprint Alfa", observation: row.text, revision: 0, ...actionFields });
  const after = await bootstrap(context.request); expect(after.tasks).toEqual(before.tasks); expect(after.sprints).toEqual(before.sprints); expect(after.workspace.retroRevision).toBe(3);
  expect(await db.collection("retro_updates").countDocuments()).toBe(1);
});

test("phase12 invalid inputs, nonselected observations and foreign owners or targets make no changes", async ({ context, db }) => {
  for (const patch of [{ kind: "vote" }, { text: " " }, { text: "a".repeat(1001) }, { text: { html: "unsafe" } }]) { const before = await snapshot(db); expect((await mutate(context.request, observation(patch))).status()).toBe(400); expect(await snapshot(db)).toEqual(before); }
  await mutate(context.request, observation()); let row = (await retro(context.request)).observations[0]; expect((await mutate(context.request, create(row))).status()).toBe(409);
  await mutate(context.request, { action: "selectRetroProblem", ...base, id: row.id, revision: 0, selected: true }); row = (await retro(context.request)).observations[0];
  for (const patch of [{ title: " " }, { title: "a".repeat(161) }, { measure: " " }, { measure: "a".repeat(1001) }, { ownerId: users.outsider.id }, { ownerId: { $ne: null } }, { targetSprintId: ids.sprintBeta }, { targetSprintId: "missing" }, { targetSprintId: undefined }, { observationRevision: -1 }, { observationId: "foreign" }]) { const before = await snapshot(db); expect((await mutate(context.request, create(row, patch))).status()).toBeGreaterThanOrEqual(400); expect(await snapshot(db)).toEqual(before); }
});

test("phase12 selection has its own revision and cannot erase an agreed problem", async ({ context, db }) => {
  const row = await selected(context.request), before = await snapshot(db);
  expect((await mutate(context.request, { action: "selectRetroProblem", ...base, id: row.id, revision: 0, selected: false })).status()).toBe(409); expect(await snapshot(db)).toEqual(before);
  const id = (await (await mutate(context.request, create(row))).json()).retroActionId;
  expect((await mutate(context.request, { action: "selectRetroProblem", ...base, id: row.id, revision: 2, selected: false })).status()).toBe(409);
  expect((await retro(context.request)).actions[0].id).toBe(id);
  await mutate(context.request, observation({ kind: "keep", text: "Revisar juntos funcionó" })); const keep = (await retro(context.request)).observations.find((r: { kind: string }) => r.kind === "keep"); expect((await mutate(context.request, { action: "selectRetroProblem", ...base, id: keep.id, revision: 0, selected: true })).status()).toBe(400);
});

test("phase12 two sessions agree once per problem and retain both independent observations", async ({ context, browser, db }) => {
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try { await login(other, users.member); const rows = await Promise.all([mutate(context.request, observation()), mutate(other.request, observation({ kind: "idea", text: "Preparar un entorno alternativo" }))]); expect(rows.map((r) => r.status())).toEqual([200, 200]);
    const row = (await retro(context.request)).observations.find((r: { kind: string }) => r.kind === "problem"); await mutate(context.request, { action: "selectRetroProblem", ...base, id: row.id, revision: 0, selected: true }); row.revision = 1;
    const results = await Promise.all([mutate(context.request, create(row)), mutate(other.request, create(row, { title: "Propuesta de la otra sesión" }))]); expect(results.map((r) => r.status())).toEqual([200, 200]); const a = await results[0].json(), b = await results[1].json(); expect(a.retroActionId).toBe(b.retroActionId);
  } finally { await other.close(); }
  expect(await db.collection("retro_actions").countDocuments()).toBe(1); expect(await db.collection("retro_updates").countDocuments()).toBe(1); expect(await db.collection("activities").countDocuments({ "event.type": "retro.action.created" })).toBe(1);
});

test("phase12 action revisions prevent silent overwrite and updates require a meaningful result", async ({ context, browser, db }) => {
  const id = await agreed(context.request), other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try { await login(other, users.member); const results = await Promise.all([mutate(context.request, update(id)), mutate(other.request, update(id, { status: "dropped", note: "Probaremos otra alternativa" }))]); expect(results.map((r) => r.status()).sort()).toEqual([200, 409]); } finally { await other.close(); }
  for (const patch of [{ note: " " }, { note: "a".repeat(1001) }, { status: "finished" }, { revision: null }, { status: "done", verified: false }]) { const before = await snapshot(db); expect((await mutate(context.request, update(id, { revision: 1, ...patch }))).status()).toBe(400); expect(await snapshot(db)).toEqual(before); }
  expect((await mutate(context.request, update(id, { revision: 1, status: "done", verified: true, note: "Todo el equipo pudo entrar el primer día" }))).status()).toBe(200);
  expect((await retro(context.request)).counts).toEqual({ open: 0, progress: 0, done: 1, dropped: 0 }); expect((await retro(context.request)).actions).toEqual([]);
  const history = await retro(context.request, `&action=${id}`); expect(history.updates).toHaveLength(3); expect(history.updates[2].state).toMatchObject({ status: "open", title: actionFields.title });
});

test("phase12 next sprint sees previous improvements and can verify them without rewriting closure", async ({ context, db }) => {
  const newSprint = await mutate(context.request, { action: "createSprint", workspaceId: ids.alpha, name: "Sprint siguiente", goal: "Comprobar mejoras", startDate: "2026-10-15", endDate: "2026-10-28" }); const next = (await newSprint.json()).sprintId;
  const row = await selected(context.request), id = (await (await mutate(context.request, create(row, { targetSprintId: next }))).json()).retroActionId;
  await mutate(context.request, { action: "closeSprint", workspaceId: ids.alpha, id: ids.sprintAlpha, revision: 0, governanceRevision: 0, summary: "Cierre del sprint", reviewed: true });
  const outcome = (await bootstrap(context.request)).sprints.find((s: { id: string }) => s.id === ids.sprintAlpha).outcome;
  await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: "task_test_backlog", revision: 0, sprintId: next, status: "todo" });
  const nextData = (await bootstrap(context.request)).sprints.find((s: { id: string }) => s.id === next); expect((await mutate(context.request, { action: "startSprint", workspaceId: ids.alpha, id: next, revision: nextData.revision })).status()).toBe(200);
  expect((await retro(context.request, "", next)).actions[0]).toMatchObject({ id, sprintId: ids.sprintAlpha, targetSprintId: next });
  expect((await mutate(context.request, update(id, { sprintId: next, targetSprintId: next, status: "done", verified: true, note: "Accesos disponibles al inicio del siguiente sprint" }))).status()).toBe(200);
  expect((await bootstrap(context.request)).sprints.find((s: { id: string }) => s.id === ids.sprintAlpha).outcome).toEqual(outcome);
  expect((await retro(context.request, "&filter=origin")).actions[0].status).toBe("done"); expect((await retro(context.request, "&filter=origin", next)).actions).toHaveLength(0);
  expect(await db.collection("tasks").countDocuments({ "retroSource": { $exists: true } })).toBe(0);
});

test("phase12 planned and cancelled sprints cannot add agreements but existing improvements remain trackable", async ({ context, db }) => {
  const id = await agreed(context.request);
  for (const status of ["planned", "cancelled"]) { await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status } }); const before = await snapshot(db);
    for (const payload of [observation(), { action: "selectRetroProblem", ...base, id: "missing", revision: 0, selected: true }, create({ id: "missing", revision: 0 })]) expect((await mutate(context.request, payload)).status()).toBe(409); expect(await snapshot(db)).toEqual(before);
  }
  expect((await mutate(context.request, update(id))).status()).toBe(200);
});

test("phase12 APIs isolate projects, scoped cursors and replay after membership revocation", async ({ context, browser, db }) => {
  const id = await agreed(context.request), payload = update(id, { mutationId: crypto.randomUUID() }); expect((await mutate(context.request, payload)).status()).toBe(200);
  const stranger = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try { expect((await stranger.request.get(`/api/retro?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`)).status()).toBe(401); await login(stranger, users.outsider);
    expect((await stranger.request.get(`/api/retro?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&action=${id}`)).status()).toBe(404);
    for (const action of ["addRetroObservation", "selectRetroProblem", "createRetroAction", "updateRetroAction"]) expect((await mutate(stranger.request, { ...payload, action })).status()).toBe(403);
  } finally { await stranger.close(); }
  for (const extra of ["&filter=bad", "&sprint=duplicate", "&action=missing&filter=all", "&before=%24bad", "&action=missing&action=again"]) expect((await context.request.get(`/api/retro?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}${extra}`)).status()).toBe(400);
  expect((await context.request.get(`/api/retro?workspace=${ids.alpha}&sprint=${ids.sprintBeta}`)).status()).toBe(404);
  expect((await context.request.get(`/api/retro?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&action=missing`)).status()).toBe(404);
  const before = await snapshot(db); expect((await mutate(context.request, update(id, { workspaceId: ids.gamma, sprintId: ids.sprintGamma }))).status()).toBe(400); expect(await snapshot(db)).toEqual(before);
  await db.collection("memberships").deleteOne({ workspaceId: ids.alpha, userId: users.owner.id }); expect((await mutate(context.request, payload)).status()).toBe(403);
});

for (const action of ["addRetroObservation", "selectRetroProblem", "createRetroAction", "updateRetroAction"]) test(`phase12 ${action} rolls back counters, agreements and history on audit failure`, async ({ context, db }) => {
  const row = await selected(context.request); let actionId = ""; if (action === "updateRetroAction") actionId = (await (await mutate(context.request, create(row))).json()).retroActionId;
  const payload = action === "addRetroObservation" ? observation() : action === "selectRetroProblem" ? { action, ...base, id: row.id, revision: 1, selected: false } : action === "createRetroAction" ? create(row) : update(actionId);
  const before = await snapshot(db); await db.command({ collMod: "activities", validator: { "event.type": { $exists: false } }, validationLevel: "strict", validationAction: "error" });
  try { expect((await mutate(context.request, payload)).status()).toBe(500); expect(await snapshot(db)).toEqual(before); } finally { await db.command({ collMod: "activities", validator: {}, validationLevel: "off" }); }
});

test("phase12 duplicate mutation keys acknowledge once and reject a different intention", async ({ context, db }) => {
  const row = await selected(context.request), payload = create(row, { mutationId: crypto.randomUUID() }); await mutate(context.request, payload); const state = await snapshot(db);
  expect((await mutate(context.request, payload)).status()).toBe(200); expect(await snapshot(db)).toEqual(state); expect((await mutate(context.request, { ...payload, title: "Diferente intención" })).status()).toBe(409); expect(await snapshot(db)).toEqual(state);
});

test("phase12 bounded pages retain equal-time actions, accurate counts and full versioned follow-up", async ({ context, db }) => {
  const id = await agreed(context.request), template = await db.collection("retro_actions").findOne({ _id: id as never });
  await db.collection("retro_actions").insertMany(Array.from({ length: 110 }, (_, i) => ({ ...template, _id: `action_page_${String(i).padStart(3, "0")}` as never, observationId: `obs_page_${i}`, sprintId: i % 2 ? ids.sprintGamma : ids.sprintAlpha, status: i < 10 ? "done" : "open", createdAt: "2026-10-21T15:00:00.000Z" })));
  let page = await retro(context.request, "&filter=all"), idsSeen = page.actions.map((a: { id: string }) => a.id); while (page.nextCursor) { page = await retro(context.request, `&filter=all&before=${page.nextCursor}`); idsSeen.push(...page.actions.map((a: { id: string }) => a.id)); } expect(new Set(idsSeen).size).toBe(111); expect(page.counts).toEqual({ open: 101, progress: 0, done: 10, dropped: 0 });
  const updateTemplate = await db.collection("retro_updates").findOne({ actionId: id }); await db.collection("retro_updates").insertMany(Array.from({ length: 110 }, (_, i) => ({ ...updateTemplate, _id: `update_page_${i}` as never, revision: i + 1 })));
  let history = await retro(context.request, `&action=${id}`), revisions = history.updates.map((r: { revision: number }) => r.revision); while (history.nextCursor) { history = await retro(context.request, `&action=${id}&before=${history.nextCursor}`); revisions.push(...history.updates.map((r: { revision: number }) => r.revision)); } expect(new Set(revisions).size).toBe(111);
  expect((await context.request.get(`/api/retro?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&action=${id}&before=foreign`)).status()).toBe(400);
});

test("phase12 observation limits are enforced atomically under concurrent additions", async ({ context, browser, db }) => {
  await mutate(context.request, observation()); const row = await db.collection("retro_observations").findOne({ workspaceId: ids.alpha });
  await db.collection("retro_observations").insertMany(Array.from({ length: 98 }, (_, i) => ({ ...row, _id: `limit_obs_${i}` as never })));
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" }); try { await login(other, users.member); const results = await Promise.all([mutate(context.request, observation()), mutate(other.request, observation())]); expect(results.map((r) => r.status()).sort()).toEqual([200, 400]); } finally { await other.close(); }
  expect(await db.collection("retro_observations").countDocuments({ workspaceId: ids.alpha })).toBe(100);
});

test("phase12 action limit, current assignee and target validation preserve the agreement history", async ({ context, db }) => {
  const id = await agreed(context.request), source = await db.collection("retro_actions").findOne({ _id: id as never });
  const row = await selected(context.request);
  await db.collection("retro_actions").insertMany(Array.from({ length: 49 }, (_, i) => ({ ...source, _id: `action_limit_${i}` as never, observationId: `obs_limit_${i}` })));
  const before = await snapshot(db); expect((await mutate(context.request, create(row))).status()).toBe(400); expect(await snapshot(db)).toEqual(before);
  await db.collection("memberships").deleteOne({ workspaceId: ids.alpha, userId: users.member.id }); expect((await mutate(context.request, update(id))).status()).toBe(400);
  expect((await mutate(context.request, update(id, { ownerId: users.owner.id, targetSprintId: ids.sprintBeta }))).status()).toBe(400);
  expect((await mutate(context.request, update(id, { ownerId: users.owner.id, status: "dropped", note: "Usaremos una alternativa que no requiere acceso" }))).status()).toBe(200);
  expect((await mutate(context.request, update(id, { ownerId: users.owner.id, revision: 1, status: "open", note: "El equipo vuelve a intentarlo" }))).status()).toBe(200);
  const detail = await retro(context.request, `&action=${id}`); expect(detail.updates).toHaveLength(3); expect(detail.updates[2].state.ownerName).toBe(users.member.name); expect(detail.action.ownerName).toBe(users.owner.name);
});

test("phase12 UI shares observations, agrees an improvement and follows it to a verified result", async ({ page, context }) => {
  await page.goto(`/?workspace=${ids.alpha}&view=board&sprint=${ids.sprintAlpha}`); await page.getByRole("button", { name: "Retrospectiva", exact: true }).click(); await expect(page).toHaveURL(/view=retro/);
  await page.getByLabel("Tipo de observación", { exact: true }).selectOption("problem"); await page.getByLabel("Observación de la retrospectiva", { exact: true }).fill("Los accesos al laboratorio llegaron tarde"); await page.getByRole("button", { name: "Compartir observación", exact: true }).click();
  await page.getByRole("button", { name: "Seleccionar problema", exact: true }).click(); await page.getByRole("button", { name: "Acordar mejora", exact: true }).click(); let dialog = await fillAction(page); await dialog.getByRole("button", { name: "Confirmar mejora", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.reload(); await page.getByRole("button", { name: "Seguimiento e historial", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Seguimiento de la mejora", exact: true }); await dialog.getByLabel("Estado de la mejora", { exact: true }).selectOption("done"); await dialog.getByLabel("Nota de seguimiento o resultado", { exact: true }).fill("Todos pudieron acceder desde el primer día"); await expect(dialog.getByRole("button", { name: "Guardar seguimiento", exact: true })).toBeDisabled(); await dialog.getByLabel("El equipo comprobó el criterio y el resultado descrito.", { exact: true }).check(); await dialog.getByRole("button", { name: "Guardar seguimiento", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByLabel("Mostrar mejoras", { exact: true }).selectOption("all"); await expect(page.getByRole("region", { name: "Seguimiento de mejoras", exact: true })).toContainText("Comprobada"); expect((await retro(context.request)).counts.done).toBe(1);
});

test("phase12 private drafts survive dismissal and reload; conflicts keep the proposed text", async ({ page, context }) => {
  const id = await agreed(context.request); await open(page); await page.getByLabel("Observación de la retrospectiva", { exact: true }).fill("Otra observación sin enviar"); await page.getByRole("button", { name: "Seguimiento e historial", exact: true }).click(); let dialog = page.getByRole("dialog", { name: "Seguimiento de la mejora", exact: true });
  await dialog.getByLabel("Nota de seguimiento o resultado", { exact: true }).fill("Mi propuesta privada"); await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await page.reload(); await expect(page.getByLabel("Observación de la retrospectiva", { exact: true })).toHaveValue("Otra observación sin enviar");
  await mutate(context.request, update(id)); await page.getByRole("button", { name: "Seguimiento e historial", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Seguimiento de la mejora", exact: true }); await expect(dialog.getByLabel("Nota de seguimiento o resultado", { exact: true })).toHaveValue("Mi propuesta privada"); await expect(dialog.getByRole("button", { name: "Guardar seguimiento", exact: true })).toBeDisabled(); await dialog.getByRole("button", { name: "Revisar versión actual de la mejora", exact: true }).click(); await dialog.getByRole("button", { name: "Guardar seguimiento", exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByLabel("Observación de la retrospectiva", { exact: true })).toHaveValue("Otra observación sin enviar");
});

for (const action of ["addRetroObservation", "selectRetroProblem", "createRetroAction", "updateRetroAction"]) test(`phase12 ${action} recovers a lost response after reload with the original key`, async ({ page, context, db }) => {
  if (action === "selectRetroProblem") await mutate(context.request, observation());
  if (action === "createRetroAction") await selected(context.request);
  if (action === "updateRetroAction") await agreed(context.request);
  await open(page); const keys: string[] = [];
  await page.route("**/api/mutate", async (route) => { const body = route.request().postDataJSON(); if (body.action !== action) return route.continue(); keys.push(body.mutationId); const response = await route.fetch(); if (keys.length === 1) await route.fulfill({ status: 500, json: { error: "Respuesta perdida" } }); else await route.fulfill({ response }); });
  let button = "";
  if (action === "addRetroObservation") { await page.getByLabel("Observación de la retrospectiva", { exact: true }).fill("Observación sin duplicar"); button = "Compartir observación"; }
  if (action === "selectRetroProblem") button = "Seleccionar problema";
  if (action === "createRetroAction") { await page.getByRole("button", { name: "Acordar mejora", exact: true }).click(); await fillAction(page); button = "Confirmar mejora"; }
  if (action === "updateRetroAction") { await page.getByRole("button", { name: "Seguimiento e historial", exact: true }).click(); await page.getByLabel("Nota de seguimiento o resultado", { exact: true }).fill("Seguimiento sin duplicar"); button = "Guardar seguimiento"; }
  await page.getByRole("button", { name: button, exact: true }).click(); await expect(page.getByRole("alert").first()).toContainText("No pudimos confirmar"); await page.reload(); await page.getByLabel("Estado de sincronización").getByRole("button", { name: "Reintentar cambio pendiente", exact: true }).click(); await expect(page.getByLabel("Estado de sincronización")).toContainText("Actualizado"); expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
  expect(await db.collection("activities").countDocuments({ "event.type": { addRetroObservation: "retro.observation.added", selectRetroProblem: "retro.problem.selected", createRetroAction: "retro.action.created", updateRetroAction: "retro.action.updated" }[action] })).toBe(1);
  if (action === "addRetroObservation") await expect(page.getByLabel("Observación de la retrospectiva", { exact: true })).toHaveValue("");
});

test("phase12 modal exit restores focus, reduced motion and blocked storage retain drafts", async ({ page, context }) => {
  await selected(context.request); await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); }; Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); }; }); await open(page);
  await page.getByRole("button", { name: "Acordar mejora", exact: true }).click(); let dialog = await fillAction(page); await expect(dialog).toContainText("Borrador solo en memoria"); await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.getByRole("button", { name: "Acordar mejora", exact: true })).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.getByRole("button", { name: "Acordar mejora", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Acordar una mejora", exact: true }); await expect(dialog.getByLabel("Acción de mejora", { exact: true })).toHaveValue(actionFields.title); await dialog.getByRole("button", { name: "Cerrar ventana", exact: true }).click(); await expect(dialog).toHaveCount(0);
});

for (const width of [320, 390, 1107]) test(`phase12 retrospective and follow-up fit ${width}px with large text`, async ({ page, context, db }) => {
  await agreed(context.request); await mutate(context.request, observation({ kind: "keep", text: "Revisar el trabajo juntos ayudó a detectar dudas" })); await mutate(context.request, observation({ kind: "idea", text: "Preparar una alternativa para el laboratorio" }));
  for (const name of ["retro_observations", "retro_actions", "retro_updates"]) await db.collection(name).updateMany({}, { $set: { createdAt: "2026-10-21T15:00:00.000Z", updatedAt: "2026-10-21T15:00:00.000Z" } });
  await page.setViewportSize({ width, height: 958 }); await page.clock.setFixedTime(new Date("2026-10-21T15:00:00.000Z")); await page.addInitScript((light) => { localStorage.setItem("sprintia-theme", light ? "light" : "dark"); localStorage.setItem("sprintia-text-size", "xlarge"); }, width === 390); await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1); await expect(page).toHaveScreenshot(`phase-12-retro-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
  const tracker = page.getByRole("region", { name: "Seguimiento de mejoras", exact: true });
  await tracker.evaluate((el) => { const headerHeight = document.querySelector("main > header")?.getBoundingClientRect().height ?? 180; window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - headerHeight - 16, behavior: "instant" }); });
  await expect(page).toHaveScreenshot(`phase-12-tracker-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
  await page.getByRole("button", { name: "Seguimiento e historial", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Seguimiento de la mejora", exact: true }); await expect(dialog.getByLabel("Acción de mejora", { exact: true })).toBeFocused(); await expect(dialog.getByRole("heading", { name: "Seguimiento de la mejora", exact: true })).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1); expect(await dialog.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("*")).filter((node) => node.getClientRects().length && Array.from(node.childNodes).some((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim()) && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.textContent))).toEqual([]);
  await expect(page).toHaveScreenshot(`phase-12-followup-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
});
