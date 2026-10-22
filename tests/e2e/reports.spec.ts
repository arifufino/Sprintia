import type { APIRequestContext, Page } from "@playwright/test";
import type { Db } from "mongodb";
import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";
const base = { workspaceId: ids.alpha }, url = `/?workspace=${ids.alpha}&view=reports&sprint=${ids.sprintAlpha}`;
const report = async (request: APIRequestContext, extra = "", sprint = ids.sprintAlpha) => (await request.get(`/api/reports?workspace=${ids.alpha}&sprint=${sprint}${extra}`)).json();
const bootstrap = async (request: APIRequestContext) => (await request.get(`/api/bootstrap?workspace=${ids.alpha}`)).json();
async function begin(request: APIRequestContext, db: Db) { await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "planned" } }); expect((await mutate(request, { action: "startSprint", ...base, id: ids.sprintAlpha, revision: 0 })).status()).toBe(200); }
async function cycle(request: APIRequestContext, db: Db) {
  await begin(request, db); await mutate(request, { action: "updateTask", ...base, id: ids.taskAlpha, points: 5, revision: 0 });
  const b = (await (await mutate(request, { action: "createTask", ...base, title: "Validación añadida", sprintId: ids.sprintAlpha, points: 2 })).json()).taskId;
  await mutate(request, { action: "updateTask", ...base, id: ids.taskAlpha, status: "done", revision: 1 });
  const c = (await (await mutate(request, { action: "createTask", ...base, title: "Trabajo exploratorio", sprintId: ids.sprintAlpha, points: null })).json()).taskId;
  await mutate(request, { action: "updateTask", ...base, id: c, status: "backlog", revision: 0 });
  const events = await db.collection("activities").find({ workspaceId: ids.alpha, "event.changes.reporting": { $exists: true } }).toArray();
  for (const event of events) { const at = `2026-10-${String(event.event.changes.reporting.after.sequence).padStart(2, "0")}T15:00:00.000Z`; await db.collection("activities").updateOne({ _id: event._id }, { $set: { createdAt: at, "event.changes.reporting.after.at": at } }); }
  return { b, c };
}
async function open(page: Page) { await page.goto(url); await expect(page.getByRole("region", { name: "Cobertura de los datos", exact: true })).toBeVisible(); }
test.beforeEach(async ({ context }) => { await login(context); });

test("phase13 legacy reads stay read-only and do not invent initial estimates or curves", async ({ context, db }) => {
  await bootstrap(context.request); const before = await snapshot(db), data = await report(context.request);
  expect(data).toMatchObject({ coverage: "none", initial: null, samples: [], current: { scope: { tasks: 1, points: 3 }, pending: { tasks: 1 }, done: { tasks: 0 } } }); expect(await snapshot(db)).toEqual(before); expect(JSON.stringify(data)).not.toContain(users.owner.email); expect(JSON.stringify(data)).not.toContain("TESTALPHA");
});
test("phase13 start captures immutable initial scope and measured changes preserve known and unknown estimates", async ({ context, db }) => {
  await cycle(context.request, db); const data = await report(context.request);
  expect(data.coverage).toBe("complete"); expect(data.initial.scope).toEqual({ tasks: 1, points: 3, unestimated: 0 }); expect(data.current).toMatchObject({ scope: { tasks: 2, points: 7 }, pending: { tasks: 1, points: 2 }, done: { tasks: 1, points: 5 } });
  expect(data.deltas).toEqual({ added: { tasks: 2, points: 2, unestimated: 1 }, removed: { tasks: 1, points: 0, unestimated: 1 }, reestimated: 1, knownPointsDelta: 2, reopened: 0 });
  expect(data.samples[0].totals.scope.points).toBe(3); expect(data.samples.at(-1).totals.pending.points).toBe(2); expect(data.changes.total).toBe(5);
  const start = await db.collection("activities").findOne({ "event.type": "sprint.started", workspaceId: ids.alpha }); expect(start?.event.changes.reporting.after.baseline[0].points).toBe(3);
});
test("phase13 report uses full structured history, not the bootstrap's twelve recent activities", async ({ context, db }) => {
  await cycle(context.request, db); const before = await report(context.request);
  for (let i = 0; i < 18; i++) await mutate(context.request, { action: "addTaskComment", ...base, id: (await bootstrap(context.request)).tasks.find((t: { title: string }) => t.title === "Validación añadida").id, text: `Conversación ${i}` });
  const after = await report(context.request); expect(after.initial).toEqual(before.initial); expect(after.changes).toEqual(before.changes); expect(after.coverage).toBe("complete"); expect((await bootstrap(context.request)).activities).toHaveLength(12);
});
test("phase13 reopens and deleting finished work are not counted as additional delivery", async ({ context, db }) => {
  await begin(context.request, db); await mutate(context.request, { action: "updateTask", ...base, id: ids.taskAlpha, revision: 0, status: "done" }); await mutate(context.request, { action: "updateTask", ...base, id: ids.taskAlpha, revision: 1, status: "todo" }); await mutate(context.request, { action: "updateTask", ...base, id: ids.taskAlpha, revision: 2, status: "done" }); await mutate(context.request, { action: "deleteTask", ...base, id: ids.taskAlpha, revision: 3 });
  const data = await report(context.request); expect(data.coverage).toBe("complete"); expect(data.current.done.tasks).toBe(0); expect(data.deltas.reopened).toBe(1); expect(data.deltas.removed.tasks).toBe(1); expect(data.changes.rows[0]).toMatchObject({ kinds: ["removed"], deleted: true });
});
test("phase13 closure freezes remaining work before automatic backlog return and later edits cannot rewrite it", async ({ context, db }) => {
  const { b } = await cycle(context.request, db), sprint = (await bootstrap(context.request)).sprints.find((s: { id: string }) => s.id === ids.sprintAlpha);
  expect((await mutate(context.request, { action: "closeSprint", ...base, id: ids.sprintAlpha, revision: sprint.revision, governanceRevision: 0, reviewed: true, summary: "Entregamos una parte y adaptaremos el resto" })).status()).toBe(200);
  const before = await report(context.request); expect(before.coverage).toBe("complete"); expect(before.current.pending.tasks).toBe(1); expect(before.samples.at(-1).totals.pending.tasks).toBe(1); expect(before.deltas.removed.tasks).toBe(1); expect(before.trend.rows[0]).toMatchObject({ status: "completed", returned: { tasks: 1, points: 2 }, initial: { scope: { points: 3 } } });
  await mutate(context.request, { action: "updateTask", ...base, id: b, revision: 1, points: 13, title: "Trabajo devuelto con otra estimación" }); expect(await report(context.request)).toEqual(before);
});
test("phase13 cancellations and legacy closures remain distinct and never fabricate initial or final zeros", async ({ context, db }) => {
  await begin(context.request, db); const sprint = (await bootstrap(context.request)).sprints[0]; await mutate(context.request, { action: "cancelSprint", ...base, id: ids.sprintAlpha, revision: sprint.revision, governanceRevision: 0, reviewed: true, reason: "Cambió el objetivo" });
  expect((await report(context.request)).trend.rows[0]).toMatchObject({ status: "cancelled", returned: { tasks: 1 } });
  await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "completed" }, $unset: { outcome: "" } }); const legacy = await report(context.request); expect(legacy.current).toBeNull(); expect(legacy.samples).toEqual([]); expect(legacy.trend.rows[0].final).toBeNull();
});
test("phase13 a legacy close snapshot remains useful without a fabricated start baseline", async ({ context }) => {
  await bootstrap(context.request); await mutate(context.request, { action: "updateTask", ...base, id: ids.taskAlpha, revision: 0, status: "done" }); const sprint = (await bootstrap(context.request)).sprints[0]; await mutate(context.request, { action: "closeSprint", ...base, id: ids.sprintAlpha, revision: sprint.revision, governanceRevision: 0, reviewed: true, summary: "Resultado de un sprint antiguo" });
  const data = await report(context.request); expect(data.coverage).toBe("none"); expect(data.current.done.points).toBe(3); expect(data.initial).toBeNull(); expect(data.trend.rows[0].initial).toBeNull();
});
test("phase13 member access, missing resources and malformed cursors cannot disclose another project", async ({ context, browser }) => {
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" }); try {
    expect((await other.request.get(`/api/reports?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`)).status()).toBe(401); await login(other, users.member); expect((await other.request.get(`/api/reports?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`)).status()).toBe(200); await login(other, users.outsider); expect((await other.request.get(`/api/reports?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`)).status()).toBe(404);
  } finally { await other.close(); }
  for (const extra of ["&before=-1", "&before=0", "&before=1.5", "&before=NaN", "&before=999999999999999999", "&sprint=duplicate", "&before=1&before=2"]) expect((await context.request.get(`/api/reports?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}${extra}`)).status()).toBe(400);
  expect((await context.request.get(`/api/reports?workspace=${ids.alpha}&sprint=${ids.sprintBeta}`)).status()).toBe(404); expect((await context.request.get(`/api/reports?workspace=${ids.alpha}&sprint=missing`)).status()).toBe(404);
  const response = await context.request.get(`/api/reports?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`); expect(response.headers()["cache-control"]).toBe("no-store");
});
for (const action of ["createTask", "updateTask", "deleteTask", "startSprint", "closeSprint"]) test(`phase13 ${action} rolls back report sequence, baseline and event on audit failure`, async ({ context, db }) => {
  await bootstrap(context.request); if (action === "startSprint") await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "planned" } });
  const payload = { action, ...base, id: action === "startSprint" || action === "closeSprint" ? ids.sprintAlpha : ids.taskAlpha, revision: 0, title: "Trabajo medible", sprintId: ids.sprintAlpha, points: 5, reviewed: true, governanceRevision: 0, summary: "Cierre que no debe confirmarse" };
  const before = await snapshot(db); await db.command({ collMod: "activities", validator: { "event.type": { $exists: false } }, validationLevel: "strict", validationAction: "error" }); try { expect((await mutate(context.request, payload)).status()).toBe(500); expect(await snapshot(db)).toEqual(before); } finally { await db.command({ collMod: "activities", validator: {}, validationLevel: "off" }); }
});
test("phase13 retries do not duplicate measurement and concurrent task changes get an unambiguous sequence", async ({ context, browser, db }) => {
  await begin(context.request, db); const payload = { action: "createTask", ...base, title: "Trabajo nuevo", sprintId: ids.sprintAlpha, points: 2, mutationId: crypto.randomUUID() }; const created = await mutate(context.request, payload); const id = (await created.json()).taskId; const state = await snapshot(db); await mutate(context.request, payload); expect(await snapshot(db)).toEqual(state);
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" }); try { await login(other, users.member); const results = await Promise.all([mutate(context.request, { action: "updateTask", ...base, id: ids.taskAlpha, revision: 0, points: 5 }), mutate(other.request, { action: "updateTask", ...base, id, revision: 0, status: "done" })]); expect(results.map((r) => r.status())).toEqual([200, 200]); } finally { await other.close(); }
  const events = await db.collection("activities").find({ workspaceId: ids.alpha, "event.changes.reporting": { $exists: true } }).toArray(); expect(new Set(events.map((e) => e.event.changes.reporting.after.sequence)).size).toBe(4); expect((await report(context.request)).coverage).toBe("complete");
});
test("phase13 missing measured writes and scope mismatches hide the curve even when estimates return to the original value", async ({ context, db }) => {
  await begin(context.request, db); await mutate(context.request, { action: "updateTask", ...base, id: ids.taskAlpha, revision: 0, points: 5 }); await mutate(context.request, { action: "updateTask", ...base, id: ids.taskAlpha, revision: 1, points: 3 }); await db.collection("activities").updateMany({ workspaceId: ids.alpha, "event.type": "task.updated" }, { $unset: { "event.changes.reporting": "" } }); const data = await report(context.request); expect(data.coverage).toBe("partial"); expect(data.samples).toEqual([]);
});
test("phase13 change pagination preserves equal-time operation order without duplicate rows", async ({ context, db }) => {
  await begin(context.request, db); for (let i = 0; i < 55; i++) await mutate(context.request, { action: "updateTask", ...base, id: ids.taskAlpha, revision: i, points: i % 2 ? 3 : 5 });
  const first = await report(context.request), second = await report(context.request, `&before=${first.changes.nextBefore}`); expect(first.coverage).toBe("complete"); expect(first.changes.rows).toHaveLength(50); expect(second.changes.rows).toHaveLength(5); expect(new Set([...first.changes.rows, ...second.changes.rows].map((r) => r.sequence)).size).toBe(55);
});
test("phase13 a large initial scope remains usable but is explicitly not charted without a bounded baseline", async ({ context, db }) => {
  const source = await db.collection("tasks").findOne({ _id: ids.taskAlpha as never }); await db.collection("tasks").insertMany(Array.from({ length: 2000 }, (_, i) => ({ ...source, _id: `report_large_${i}` as never, code: `LARGE-${i}` })));
  await begin(context.request, db); const data = await report(context.request); expect(data.coverage).toBe("limit"); expect(data.current.scope.tasks).toBe(2001); expect(data.samples).toEqual([]);
});
test("phase13 too many events are flagged instead of drawing a silently truncated curve", async ({ context, db }) => {
  await begin(context.request, db); const metric = { id: ids.taskAlpha, code: "UNI-01", status: "todo", points: 3, sprintId: ids.sprintAlpha };
  await db.collection("activities").insertMany(Array.from({ length: 10001 }, (_, i) => ({ _id: `report_limit_${i}` as never, workspaceId: ids.alpha, createdAt: new Date().toISOString(), event: { type: "task.updated", entityId: ids.taskAlpha, changes: { reporting: { after: { version: 1, sequence: i + 2, kind: "task", at: new Date().toISOString(), sprintIds: [ids.sprintAlpha], metricBefore: metric, metricAfter: metric } } } } })));
  const data = await report(context.request); expect(data.coverage).toBe("limit"); expect(data.samples).toEqual([]);
});
test("phase13 UI exposes exact table data, units, closed results and reloadable navigation without writes", async ({ page, context, db }) => {
  await cycle(context.request, db); let writes = 0; page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/mutate")) writes++; });
  await page.goto(`/?workspace=${ids.alpha}&view=board&sprint=${ids.sprintAlpha}`); await page.getByRole("button", { name: "Informe del sprint", exact: true }).click(); await expect(page).toHaveURL(/view=reports/); await expect(page.getByRole("region", { name: "Cobertura de los datos", exact: true })).toContainText("Serie desde el inicio registrado");
  await page.getByRole("button", { name: "Actualizar informe", exact: true }).click(); await page.getByLabel("Unidad del informe", { exact: true }).selectOption("points"); await page.getByText("Ver datos del gráfico", { exact: true }).click(); await expect(page.getByRole("region", { name: "Tabla de datos del gráfico", exact: true })).toContainText("Puntos".toLowerCase());
  await page.reload(); await expect(page).toHaveURL(/view=reports/); await expect(page.getByRole("img", { name: /Evolución en tareas/ })).toBeVisible(); await page.getByRole("button", { name: "Volver al Tablero", exact: true }).click(); await page.goBack(); await expect(page).toHaveURL(/view=reports/); expect(writes).toBe(0);
});
test("phase13 failed reads can retry and legacy UI avoids a misleading empty graph", async ({ page }) => {
  await page.route("**/api/reports?**", (route) => route.fulfill({ status: 503, json: { error: "Offline" } })); await page.goto(url); await expect(page.getByRole("alert").first()).toContainText("No pudimos calcular"); await page.unroute("**/api/reports?**"); await page.getByRole("button", { name: "Actualizar informe", exact: true }).click(); await expect(page.getByRole("region", { name: "Cobertura de los datos", exact: true })).toContainText("No hay una instantánea"); await expect(page.getByRole("img", { name: /Evolución/ })).toHaveCount(0);
});
test("phase13 trends are bounded, include absent periods honestly and exclude cancelled bars", async ({ page, context, db }) => {
  await cycle(context.request, db); const sprint = (await bootstrap(context.request)).sprints[0]; await mutate(context.request, { action: "closeSprint", ...base, id: ids.sprintAlpha, revision: sprint.revision, governanceRevision: 0, reviewed: true, summary: "Resultado medible" });
  const source = await db.collection("sprints").findOne({ _id: ids.sprintAlpha as never });
  await db.collection("sprints").insertMany(Array.from({ length: 15 }, (_, i) => ({ ...source, _id: `report_trend_${i}` as never, name: `Histórico ${i}`, status: i % 2 ? "cancelled" : "completed", outcome: i === 14 ? undefined : { ...source!.outcome, kind: i % 2 ? "cancelled" : "completed", endedAt: `2026-10-${String(i + 1).padStart(2, "0")}T15:00:00.000Z` } })));
  const data = await report(context.request); expect(data.trend.rows).toHaveLength(12); expect(data.trend.total).toBe(16); expect((await report(context.request, "", "report_trend_14")).current).toBeNull();
  await open(page); const region = page.getByRole("region", { name: "Tendencias de sprints finalizados", exact: true }); await expect(region).toContainText("12 de 16"); expect(await region.locator('[aria-label*="terminados"]').count()).toBe(data.trend.rows.filter((r: { status: string; final: unknown }) => r.status === "completed" && r.final).length);
});
test("phase13 a late response cannot replace a newly selected sprint", async ({ page, context, db }) => {
  await cycle(context.request, db); const next = (await (await mutate(context.request, { action: "createSprint", ...base, name: "Plan sin historia", goal: "Esperar al inicio" })).json()).sprintId;
  let release!: () => void, received!: () => void, finished!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }), pending = new Promise<void>((resolve) => { received = resolve; }), done = new Promise<void>((resolve) => { finished = resolve; });
  await page.route(`**/api/reports?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`, async (route) => { const response = await route.fetch(); received(); await gate; try { await route.fulfill({ response }); } catch { /* The old request was intentionally aborted. */ } finally { finished(); } });
  await page.goto(url); await pending; await page.getByLabel("Sprint del informe", { exact: true }).selectOption(next); await expect(page.getByRole("region", { name: "Cobertura de los datos", exact: true })).toContainText("aún no se inició"); release(); await done; await expect(page).toHaveURL(new RegExp(`sprint=${next}`)); await expect(page.getByRole("img", { name: /Evolución/ })).toHaveCount(0);
});
for (const width of [320, 390, 1107]) test(`phase13 reports and accessible charts fit ${width}px with large text`, async ({ page, context, db }) => {
  await cycle(context.request, db); const sprint = (await bootstrap(context.request)).sprints[0]; await mutate(context.request, { action: "closeSprint", ...base, id: ids.sprintAlpha, revision: sprint.revision, governanceRevision: 0, reviewed: true, summary: "Resultado con una tarea pendiente para adaptar" });
  await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { "outcome.endedAt": "2026-10-10T15:00:00.000Z" } });
  await db.collection("activities").updateOne({ workspaceId: ids.alpha, "event.type": "sprint.completed" }, { $set: { createdAt: "2026-10-10T15:00:00.000Z", "event.changes.reporting.after.at": "2026-10-10T15:00:00.000Z" } });
  await page.clock.setFixedTime(new Date("2026-10-21T15:00:00.000Z"));
  await page.setViewportSize({ width, height: 958 }); await page.addInitScript((light) => { localStorage.setItem("sprintia-theme", light ? "light" : "dark"); localStorage.setItem("sprintia-text-size", "xlarge"); }, width === 390); await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.getByRole("article").first().locator("strong").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
  const chart = page.getByRole("region", { name: "Evolución del sprint", exact: true }); await chart.evaluate((el) => { const height = document.querySelector("main > header")?.getBoundingClientRect().height ?? 180; window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - height - 16, behavior: "instant" }); });
  await expect(page).toHaveScreenshot(`phase-13-chart-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
  await page.getByLabel("Unidad del informe", { exact: true }).selectOption("points"); await chart.getByText("Ver datos del gráfico", { exact: true }).click(); await expect(page.getByRole("region", { name: "Tabla de datos del gráfico", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await chart.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("*")).filter((node) => node.getClientRects().length && Array.from(node.childNodes).some((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim()) && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.textContent))).toEqual([]);
  const trend = page.getByRole("region", { name: "Tendencias de sprints finalizados", exact: true });
  await trend.evaluate((el) => { const height = document.querySelector("main > header")?.getBoundingClientRect().height ?? 180; window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - height - 16, behavior: "instant" }); });
  await expect(page).toHaveScreenshot(`phase-13-trend-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
});
