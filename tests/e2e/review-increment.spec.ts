import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";

const save = (patch: Record<string, unknown> = {}) => ({ action: "saveSprintReview", workspaceId: ids.alpha, sprintId: ids.sprintAlpha, revision: 0, sprintRevision: 0, governanceRevision: 0, summary: "El equipo validó el recorrido con usuarios", evidence: [{ label: "Demostración", url: "https://example.invalid/demo" }], taskIds: [ids.taskAlpha], verified: true, ...patch });
const entry = (patch: Record<string, unknown> = {}) => ({ action: "addReviewEntry", workspaceId: ids.alpha, sprintId: ids.sprintAlpha, kind: "decision", text: "Simplificar la navegación del prototipo", ...patch });
const convert = (entryId: string, patch: Record<string, unknown> = {}) => ({ action: "convertReviewDecision", workspaceId: ids.alpha, sprintId: ids.sprintAlpha, entryId, title: "Simplificar la navegación", description: "Ajuste acordado tras la demostración", ...patch });
const bootstrap = async (request: APIRequestContext) => (await request.get(`/api/bootstrap?workspace=${ids.alpha}`)).json();
const review = async (request: APIRequestContext, before = "") => (await request.get(`/api/review?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}${before ? `&before=${before}` : ""}`)).json();
const open = async (page: Page) => { await page.goto(`/?workspace=${ids.alpha}&view=review&sprint=${ids.sprintAlpha}`); await expect(page.getByRole("button", { name: "Registrar resultado", exact: true })).toBeEnabled(); };
const openEditor = async (page: Page) => { await page.getByRole("button", { name: "Registrar resultado", exact: true }).click(); return page.getByRole("dialog", { name: "Registrar resultado de la Review", exact: true }); };

test.beforeEach(async ({ context, db }) => {
  await login(context); await bootstrap(context.request);
  await db.collection("workspaces").updateOne({ _id: ids.alpha as never }, { $set: { definitionOfDone: ["Revisado por el equipo", "Pruebas del recorrido aprobadas"], productGoal: "Mejorar el trabajo universitario" } });
  await db.collection("tasks").updateOne({ _id: ids.taskAlpha as never }, { $set: { status: "done" } });
});

test("phase11 legacy sprints expose an empty Review without fabricated records or revisions", async ({ context, db }) => {
  const before = await snapshot(db); expect(await review(context.request)).toEqual({ revision: 0, increment: null, entries: [], nextCursor: null });
  expect((await bootstrap(context.request)).sprints[0].reviewRevision).toBe(0); expect(await snapshot(db)).toEqual(before);
  expect(await db.collection("sprints").countDocuments({ reviewRevision: { $exists: true } })).toBe(0);
});

test("phase11 increment snapshots eligible work, agreements and evidence without changing tasks or closure requirements", async ({ context, db }) => {
  const original = await bootstrap(context.request); const payload = save({ mutationId: crypto.randomUUID() });
  expect((await mutate(context.request, payload)).status()).toBe(200);
  const data = await review(context.request); expect(data).toMatchObject({ revision: 1, increment: { summary: payload.summary, definitionOfDone: ["Revisado por el equipo", "Pruebas del recorrido aprobadas"], evidence: payload.evidence, sourceStatus: "active", tasks: [{ id: ids.taskAlpha, revision: 0 }] } });
  expect(data.increment.tasks[0].title).toBe("Preparar entrevista Alfa");
  const after = await bootstrap(context.request); expect(after.tasks).toEqual(original.tasks); expect(after.sprints[0]).toMatchObject({ status: "active", revision: 0, reviewRevision: 1, outcome: null });
  const state = await snapshot(db); expect((await mutate(context.request, payload)).status()).toBe(200); expect(await snapshot(db)).toEqual(state);
  expect(await db.collection("review_revisions").countDocuments()).toBe(1);
  expect((await mutate(context.request, { action: "closeSprint", workspaceId: ids.alpha, id: ids.sprintAlpha, revision: 0, governanceRevision: 0, summary: "Entrega compartida", reviewed: true })).status()).toBe(200);
});

test("phase11 only finished unblocked work from the authorized sprint can be certified", async ({ context, db }) => {
  for (const patch of [{ taskIds: [ids.taskBeta] }, { taskIds: ["task_test_backlog"] }, { taskIds: [ids.taskAlpha, ids.taskAlpha] }, { taskIds: "all" }, { taskIds: [false] }, { verified: false }, { revision: -1 }, { sprintRevision: undefined }, { summary: " " }, { summary: "x".repeat(2001) }, { evidence: [{ label: "Unsafe", url: "javascript:alert(1)" }] }, { evidence: [{ label: "Private", url: "https://name:password@example.invalid" }] }, { evidence: [{ label: "", url: "https://example.invalid" }] }, { evidence: Array(11).fill({ label: "demo", url: "https://example.invalid" }) }]) {
    const before = await snapshot(db); expect((await mutate(context.request, save(patch))).status()).toBeGreaterThanOrEqual(400); expect(await snapshot(db)).toEqual(before);
  }
  await db.collection("tasks").updateOne({ _id: ids.taskAlpha as never }, { $set: { status: "progress" } });
  expect((await mutate(context.request, save())).status()).toBe(409);
  await db.collection("tasks").updateOne({ _id: ids.taskAlpha as never }, { $set: { status: "done", impediment: { reason: "Legacy blocker" } } });
  expect((await mutate(context.request, save())).status()).toBe(409);
});

test("phase11 no DoD means no invented certification but an honest empty increment is allowed", async ({ context, db }) => {
  await db.collection("workspaces").updateOne({ _id: ids.alpha as never }, { $set: { definitionOfDone: [] } });
  expect((await mutate(context.request, save())).status()).toBe(409);
  expect((await mutate(context.request, save({ taskIds: [], evidence: [], summary: "No se terminó trabajo que cumpla los acuerdos" }))).status()).toBe(200);
  expect((await review(context.request)).increment).toMatchObject({ tasks: [], definitionOfDone: [] });
});

test("phase11 stale task scope, governance and Review versions preserve the shared result", async ({ context, db }) => {
  expect((await mutate(context.request, save())).status()).toBe(200);
  const before = await snapshot(db); expect((await mutate(context.request, save({ summary: "No pisar" }))).status()).toBe(409); expect(await snapshot(db)).toEqual(before);
  await mutate(context.request, { action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 0, title: "Título actualizado" });
  expect((await mutate(context.request, save({ revision: 1 }))).status()).toBe(409);
  await db.collection("workspaces").updateOne({ _id: ids.alpha as never }, { $inc: { governanceRevision: 1 } });
  expect((await mutate(context.request, save({ revision: 1, sprintRevision: 1 }))).status()).toBe(409);
  expect((await review(context.request)).increment.tasks[0].title).toBe("Preparar entrevista Alfa");
  expect((await db.collection("review_revisions").findOne({ workspaceId: ids.alpha, revision: 1 }))?.increment.tasks[0].title).toBe("Preparar entrevista Alfa");
});

test("phase11 two sessions cannot overwrite the same increment revision", async ({ context, browser }) => {
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try { await login(other, users.member); const results = await Promise.all([mutate(context.request, save()), mutate(other.request, save({ summary: "Otro resultado" }))]); expect(results.map((r) => r.status()).sort()).toEqual([200, 409]); }
  finally { await other.close(); }
  expect((await review(context.request)).revision).toBe(1);
});

test("phase11 completed Review uses frozen DoD and tasks without rewriting the sprint outcome", async ({ context, db }) => {
  await mutate(context.request, { action: "closeSprint", workspaceId: ids.alpha, id: ids.sprintAlpha, revision: 0, governanceRevision: 0, reviewed: true, summary: "Resultado al finalizar" });
  const outcome = (await bootstrap(context.request)).sprints[0].outcome;
  await db.collection("workspaces").updateOne({ _id: ids.alpha as never }, { $set: { definitionOfDone: ["Criterio nuevo"], governanceRevision: 99 } });
  await db.collection("tasks").deleteOne({ _id: ids.taskAlpha as never });
  expect((await mutate(context.request, save({ sprintRevision: 1, governanceRevision: 99 }))).status()).toBe(200);
  const result = await review(context.request); expect(result.increment).toMatchObject({ sourceStatus: "completed", definitionOfDone: outcome.definitionOfDone, tasks: [{ id: ids.taskAlpha, title: "Preparar entrevista Alfa" }] });
  expect((await bootstrap(context.request)).sprints[0].outcome).toEqual(outcome);
});

test("phase11 legacy completed sprints accept feedback but cannot fabricate a past increment", async ({ context, db }) => {
  await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "completed" } });
  expect((await mutate(context.request, save())).status()).toBe(409);
  expect((await mutate(context.request, entry({ kind: "feedback" }))).status()).toBe(200);
  expect((await review(context.request)).increment).toBeNull();
});

test("phase11 planned, cancelled, foreign projects and forged source references cannot write", async ({ context, db }) => {
  for (const status of ["planned", "cancelled"]) {
    await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status } }); const before = await snapshot(db);
    for (const payload of [save(), entry(), convert("missing")]) expect((await mutate(context.request, payload)).status()).toBe(409);
    expect(await snapshot(db)).toEqual(before);
  }
  await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "active" } });
  for (const payload of [save({ workspaceId: ids.beta, sprintId: ids.sprintBeta }), entry({ workspaceId: ids.beta, sprintId: ids.sprintBeta }), convert("missing", { workspaceId: ids.beta, sprintId: ids.sprintBeta })]) expect((await mutate(context.request, payload)).status()).toBe(403);
  expect((await mutate(context.request, save({ sprintId: ids.sprintBeta }))).status()).toBe(400);
  const created = await mutate(context.request, { action: "createTask", workspaceId: ids.alpha, title: "Sin origen manipulado", status: "backlog", reviewSource: { sprintId: ids.sprintBeta, entryId: "fake" } }); expect(created.status()).toBe(200);
  expect((await db.collection("tasks").findOne({ title: "Sin origen manipulado" }))?.reviewSource).toBeUndefined();
});

test("phase11 concurrent feedback appends both messages without invalidating an increment draft", async ({ context, browser }) => {
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" }); const payload = entry({ mutationId: crypto.randomUUID() });
  try { await login(other, users.member); const results = await Promise.all([mutate(context.request, payload), mutate(other.request, entry({ text: "Aclarar la navegación", kind: "feedback" }))]); expect(results.map((r) => r.status())).toEqual([200, 200]); }
  finally { await other.close(); }
  expect((await review(context.request)).entries).toHaveLength(2); expect((await review(context.request)).revision).toBe(0);
  expect((await mutate(context.request, payload)).status()).toBe(200); expect((await review(context.request)).entries).toHaveLength(2);
});

test("phase11 decision conversion is atomic, idempotent across users and preserves both directions", async ({ context, browser, db }) => {
  await mutate(context.request, entry()); const decision = (await review(context.request)).entries[0]; const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" }); let responses: { taskId: string }[] = [];
  try { await login(other, users.member); const results = await Promise.all([mutate(context.request, convert(decision.id)), mutate(other.request, convert(decision.id, { title: "Otro título propuesto" }))]); expect(results.map((r) => r.status())).toEqual([200, 200]); responses = await Promise.all(results.map((r) => r.json())); }
  finally { await other.close(); }
  const [a, b] = responses; expect(a.taskId).toBe(b.taskId);
  const task = await db.collection("tasks").findOne({ _id: a.taskId as never }); expect(task).toMatchObject({ status: "backlog", sprintId: null, points: null, assigneeId: null, revision: 0, reviewSource: { sprintId: ids.sprintAlpha, entryId: decision.id } });
  expect((await review(context.request)).entries[0].backlogTask.id).toBe(a.taskId);
  expect(await db.collection("tasks").countDocuments({ "reviewSource.entryId": decision.id })).toBe(1); expect(await db.collection("activities").countDocuments({ "event.type": "review.decision.converted" })).toBe(1);
  const before = await snapshot(db); const payload = convert(decision.id, { mutationId: crypto.randomUUID() }); await mutate(context.request, payload); const recorded = await snapshot(db); await mutate(context.request, payload); expect(await snapshot(db)).toEqual(recorded); expect(recorded.tasks).toEqual(before.tasks);
});

test("phase11 only decisions convert; removed backlog items retain their reference and are not recreated", async ({ context, db }) => {
  await mutate(context.request, entry({ kind: "feedback" })); const feedback = (await review(context.request)).entries[0]; expect((await mutate(context.request, convert(feedback.id))).status()).toBe(400);
  await mutate(context.request, entry()); const decision = (await review(context.request)).entries.find((e: { kind: string }) => e.kind === "decision");
  for (const patch of [{ title: " " }, { title: "x".repeat(161) }, { description: "x".repeat(1201) }, { sprintId: ids.sprintBeta }, { entryId: feedback.id }]) expect((await mutate(context.request, convert(decision.id, patch))).status()).toBeGreaterThanOrEqual(400);
  const response = await mutate(context.request, convert(decision.id)); const { taskId } = await response.json();
  await mutate(context.request, { action: "deleteTask", workspaceId: ids.alpha, id: taskId, revision: 0 });
  expect((await (await mutate(context.request, convert(decision.id))).json()).taskId).toBe(taskId); expect(await db.collection("tasks").countDocuments({ "reviewSource.entryId": decision.id })).toBe(0);
});

for (const action of ["saveSprintReview", "addReviewEntry", "convertReviewDecision"]) test(`phase11 ${action} rolls back all data when audit storage fails`, async ({ context, db }) => {
  await mutate(context.request, entry()); const decision = (await review(context.request)).entries[0]; const before = await snapshot(db);
  await db.command({ collMod: "activities", validator: { "event.type": { $exists: false } }, validationLevel: "strict", validationAction: "error" });
  try { expect((await mutate(context.request, action === "saveSprintReview" ? save() : action === "addReviewEntry" ? entry() : convert(decision.id))).status()).toBe(500); expect(await snapshot(db)).toEqual(before); }
  finally { await db.command({ collMod: "activities", validator: {}, validationLevel: "off" }); }
});

test("phase11 receipts reauthorize membership and the read endpoint isolates cursors and parameters", async ({ context, db, request }) => {
  expect((await request.get(`/api/review?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`)).status()).toBe(401);
  for (const query of [`workspace=${ids.beta}&sprint=${ids.sprintBeta}`, `workspace=${ids.alpha}&sprint=${ids.sprintBeta}`, `workspace=${ids.alpha}&sprint=missing`]) expect((await context.request.get(`/api/review?${query}`)).status()).toBe(404);
  for (const query of [`workspace=${ids.alpha}`, `workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&sprint=duplicate`, `workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&before=`, `workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&before=foreign`]) expect((await context.request.get(`/api/review?${query}`)).status()).toBe(400);
  const payload = entry({ mutationId: crypto.randomUUID() }); await mutate(context.request, payload);
  await db.collection("memberships").deleteOne({ workspaceId: ids.alpha, userId: users.owner.id });
  expect((await mutate(context.request, payload)).status()).toBe(403); expect((await context.request.get(`/api/review?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`)).status()).toBe(404);
});

test("phase11 tied timestamps paginate without duplicate or skipped contributions", async ({ context, db }) => {
  await db.collection("review_entries").insertMany(Array.from({ length: 65 }, (_, i) => ({ _id: `review_${String(i).padStart(3, "0")}` as never, workspaceId: ids.alpha, sprintId: ids.sprintAlpha, kind: "feedback", text: `Aporte ${i}`, actorId: users.owner.id, actorName: users.owner.name, createdAt: "2026-10-21T15:00:00.000Z", backlogTask: null })));
  const first = await review(context.request); expect(first.entries).toHaveLength(50); const second = await review(context.request, first.nextCursor); expect(second.entries).toHaveLength(15); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.entries, ...second.entries].map((e) => e.id)).size).toBe(65);
});

test("phase11 UI records evidence, collects a decision, converts it and returns through its provenance", async ({ page, context, db }) => {
  await page.goto(`/?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`); await page.getByRole("button", { name: "Review e incremento", exact: true }).click();
  await expect(page).toHaveURL(/view=review/); const dialog = await openEditor(page);
  await dialog.getByLabel("Resultado conseguido", { exact: true }).fill("Recorrido validado en la demostración");
  await dialog.getByLabel("UNI-01 · Preparar entrevista Alfa", { exact: true }).check();
  await dialog.getByRole("button", { name: "Añadir evidencia", exact: true }).click(); await dialog.getByLabel("Nombre de evidencia 1", { exact: true }).fill("Prototipo"); await dialog.getByLabel("Enlace de evidencia 1", { exact: true }).fill("https://example.invalid/prototipo");
  await dialog.getByLabel("Confirmo la revisión del resultado y la Definition of Done aplicable.", { exact: true }).check(); await dialog.getByRole("button", { name: "Guardar resultado", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Incremento registrado", exact: true })).toContainText("Recorrido validado");
  await page.getByLabel("Tipo de aportación", { exact: true }).selectOption("decision"); await page.getByLabel("Aportación a la Review", { exact: true }).fill("Facilitar la navegación"); await page.getByRole("button", { name: "Compartir aportación", exact: true }).click();
  await expect(page.getByLabel("Aportación a la Review", { exact: true })).toHaveValue(""); await page.getByRole("button", { name: "Crear elemento del backlog", exact: true }).click();
  const conversion = page.getByRole("dialog", { name: "Decisión al backlog", exact: true }); await conversion.getByLabel("Título del elemento", { exact: true }).fill("Mejorar navegación del menú"); await conversion.getByRole("button", { name: "Crear en el backlog", exact: true }).click(); await expect(conversion).toHaveCount(0);
  await page.getByRole("button", { name: "Abrir elemento del backlog", exact: true }).click(); const task = page.getByRole("dialog", { name: "UNI-03", exact: true }); await expect(task).toContainText("Origen: decisión de la Review");
  await task.getByRole("button", { name: "Ver Review de origen", exact: true }).click(); await expect(task).toHaveCount(0); await expect(page).toHaveURL(/view=review/); await page.reload(); await expect(page.getByRole("region", { name: "Feedback y decisiones", exact: true })).toContainText("Mejorar navegación del menú");
  expect(await db.collection("tasks").countDocuments({ "reviewSource.sprintId": ids.sprintAlpha })).toBe(1);
});

test("phase11 increment draft survives closing, reload and concurrent changes with explicit review", async ({ page, context }) => {
  await open(page); let dialog = await openEditor(page); await dialog.getByLabel("Resultado conseguido", { exact: true }).fill("Mi resultado sin compartir"); await dialog.getByRole("button", { name: "Volver sin guardar", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await mutate(context.request, save({ summary: "Resultado compartido en otra sesión" })); await page.reload(); await page.getByRole("button", { name: "Actualizar incremento", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Registrar resultado de la Review", exact: true });
  await expect(dialog.getByLabel("Resultado conseguido", { exact: true })).toHaveValue("Mi resultado sin compartir"); await expect(dialog).toContainText("El incremento, las tareas o los acuerdos cambiaron");
  await dialog.getByRole("button", { name: "Revisar versión actual de la Review", exact: true }).click(); await dialog.getByLabel("Confirmo la revisión del resultado y la Definition of Done aplicable.", { exact: true }).check(); await dialog.getByRole("button", { name: "Guardar resultado", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect((await review(context.request)).increment.summary).toBe("Mi resultado sin compartir");
});

for (const action of ["addReviewEntry", "saveSprintReview", "convertReviewDecision"]) test(`phase11 uncertain ${action} keeps the original intent across reload`, async ({ page, context, db }) => {
  if (action === "convertReviewDecision") await mutate(context.request, entry());
  await open(page);
  if (action === "saveSprintReview") { const dialog = await openEditor(page); await dialog.getByLabel("Resultado conseguido", { exact: true }).fill("Un resultado confirmado una vez"); await dialog.getByLabel("Confirmo la revisión del resultado y la Definition of Done aplicable.", { exact: true }).check(); }
  else if (action === "addReviewEntry") await page.getByLabel("Aportación a la Review", { exact: true }).fill("Una sola aportación");
  else await page.getByRole("button", { name: "Crear elemento del backlog", exact: true }).click();
  const keys: string[] = []; await page.route("**/api/mutate", async (route) => { keys.push(route.request().postDataJSON().mutationId); if (keys.length === 1) { await route.fetch(); await route.abort("failed"); } else await route.continue(); });
  await page.getByRole("button", { name: action === "saveSprintReview" ? "Guardar resultado" : action === "addReviewEntry" ? "Compartir aportación" : "Crear en el backlog", exact: true }).click(); await expect(page.getByRole("alert").first()).toContainText("No pudimos confirmar");
  await page.reload(); await page.getByLabel("Estado de sincronización").getByRole("button", { name: "Reintentar cambio pendiente", exact: true }).click(); await expect(page.getByLabel("Estado de sincronización")).toContainText("Actualizado");
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
  if (action === "addReviewEntry") { expect(await db.collection("review_entries").countDocuments()).toBe(1); await expect(page.getByLabel("Aportación a la Review", { exact: true })).toHaveValue(""); }
  if (action === "saveSprintReview") expect(await db.collection("sprint_reviews").countDocuments()).toBe(1);
  if (action === "convertReviewDecision") expect(await db.collection("tasks").countDocuments({ "reviewSource.sprintId": ids.sprintAlpha })).toBe(1);
});

test("phase11 Review dialogs restore focus, exit smoothly and respect reduced motion", async ({ page }) => {
  await open(page); const dialog = await openEditor(page); await expect(dialog.getByLabel("Resultado conseguido", { exact: true })).toBeFocused(); await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.getByRole("button", { name: "Registrar resultado", exact: true })).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" }); const next = await openEditor(page); await next.getByRole("button", { name: "Cerrar ventana", exact: true }).click(); await expect(next).toHaveCount(0);
});

for (const width of [320, 390, 1107]) test(`phase11 Review and increment editor fit ${width}px with large text`, async ({ page, context, db }) => {
  await mutate(context.request, save()); await mutate(context.request, entry()); await mutate(context.request, entry({ kind: "feedback", text: "La demostración permitió entender el objetivo. Probemos el flujo con compañeros." }));
  await db.collection("sprint_reviews").updateMany({}, { $set: { "increment.recordedAt": "2026-10-21T15:00:00.000Z" } });
  await db.collection("review_entries").updateMany({ kind: "decision" }, { $set: { createdAt: "2026-10-21T15:00:00.000Z" } });
  await db.collection("review_entries").updateMany({ kind: "feedback" }, { $set: { createdAt: "2026-10-21T15:10:00.000Z" } });
  await page.setViewportSize({ width, height: 958 }); await page.clock.setFixedTime(new Date("2026-10-21T15:00:00.000Z"));
  await page.addInitScript((light) => { localStorage.setItem("sprintia-theme", light ? "light" : "dark"); localStorage.setItem("sprintia-text-size", "xlarge"); }, width === 390);
  await page.goto(`/?workspace=${ids.alpha}&view=review&sprint=${ids.sprintAlpha}`); await expect(page.getByRole("button", { name: "Actualizar incremento", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page).toHaveScreenshot(`phase-11-review-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
  await page.getByRole("button", { name: "Actualizar incremento", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Registrar resultado de la Review", exact: true }); await expect(dialog.getByLabel("Resultado conseguido", { exact: true })).toBeFocused();
  await expect(dialog.getByRole("heading", { name: "Registrar resultado de la Review", exact: true })).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await dialog.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("*")).filter((node) => node.getClientRects().length && Array.from(node.childNodes).some((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim()) && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.textContent))).toEqual([]);
  await expect(page).toHaveScreenshot(`phase-11-increment-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
});

test("phase11 removing shared DoD lets a member explicitly remove certification while preserving its old version", async ({ page, context, db }) => {
  await mutate(context.request, save());
  await db.collection("workspaces").updateOne({ _id: ids.alpha as never }, { $set: { definitionOfDone: [] }, $inc: { governanceRevision: 1 } });
  await page.goto(`/?workspace=${ids.alpha}&view=review&sprint=${ids.sprintAlpha}`); await page.getByRole("button", { name: "Actualizar incremento", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar resultado de la Review", exact: true });
  const selected = dialog.getByLabel("UNI-01 · Preparar entrevista Alfa", { exact: true }); await expect(selected).toBeChecked(); await expect(selected).toBeEnabled(); await selected.uncheck();
  await dialog.getByLabel("Confirmo la revisión del resultado y la Definition of Done aplicable.", { exact: true }).check(); await dialog.getByRole("button", { name: "Guardar resultado", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect((await review(context.request)).increment.tasks).toHaveLength(0);
  expect((await db.collection("review_revisions").findOne({ workspaceId: ids.alpha, revision: 1 }))?.increment.tasks).toHaveLength(1);
});

test("phase11 blocked storage keeps an in-memory private result draft through dialog dismissal", async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); }; Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); }; });
  await open(page); let dialog = await openEditor(page); await dialog.getByLabel("Resultado conseguido", { exact: true }).fill("Mi resultado privado en memoria");
  await expect(dialog).toContainText("Borrador solo en memoria"); await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  dialog = await openEditor(page); await expect(dialog.getByLabel("Resultado conseguido", { exact: true })).toHaveValue("Mi resultado privado en memoria");
});

test("phase11 old decisions refresh their saved reference after conversion without losing pages or another draft", async ({ page, context, db }) => {
  const seed = (prefix: string, count: number, at: string) => db.collection("review_entries").insertMany(Array.from({ length: count }, (_, i) => ({ _id: `${prefix}_${String(i).padStart(3, "0")}` as never, workspaceId: ids.alpha, sprintId: ids.sprintAlpha, kind: prefix === "review_old" && i === 0 ? "decision" : "feedback", text: `${prefix} ${i}`, actorId: users.owner.id, actorName: users.owner.name, createdAt: at, backlogTask: null })));
  await seed("review_old", 65, "2026-10-21T14:00:00.000Z"); await open(page);
  const region = page.getByRole("region", { name: "Feedback y decisiones", exact: true }), rows = region.getByRole("listitem");
  await expect(rows).toHaveCount(50); await page.getByRole("button", { name: "Cargar aportaciones anteriores", exact: true }).click(); await expect(rows).toHaveCount(65);
  await page.getByLabel("Aportación a la Review", { exact: true }).fill("Otro borrador que no debe desaparecer");
  await seed("review_new", 60, "2026-10-21T16:00:00.000Z"); await page.getByRole("button", { name: "Actualizar Review", exact: true }).click(); await expect(rows).toHaveCount(115);
  await page.getByRole("button", { name: "Cargar aportaciones anteriores", exact: true }).click(); await expect(rows).toHaveCount(125);
  await page.getByRole("button", { name: "Crear elemento del backlog", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Decisión al backlog", exact: true }); await dialog.getByLabel("Título del elemento", { exact: true }).fill("Mejora desde una decisión antigua"); await dialog.getByRole("button", { name: "Crear en el backlog", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Abrir elemento del backlog", exact: true })).toHaveCount(1); await expect(rows).toHaveCount(125); await expect(page.getByLabel("Aportación a la Review", { exact: true })).toHaveValue("Otro borrador que no debe desaparecer");
  const single = await context.request.get(`/api/review?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&entry=review_old_000`); expect(single.status()).toBe(200); expect((await single.json()).entries[0].backlogTask.title).toBe("Mejora desde una decisión antigua");
  expect((await context.request.get(`/api/review?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&entry=foreign`)).status()).toBe(404);
  expect((await context.request.get(`/api/review?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&entry=review_old_000&before=review_old_001`)).status()).toBe(400);
  expect((await context.request.get(`/api/review?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}&entry=review_old_000&entry=review_old_001`)).status()).toBe(400);
});
