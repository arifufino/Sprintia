import { mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import type { CollectionInfo } from "mongodb";
import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";
import { archiveCollections, captureDatabase, sealArchive, openArchive, restoreDatabase } from "../../scripts/lib/recovery.mjs";
const base = { workspaceId: ids.alpha }, exportUrl = `/api/export?workspace=${ids.alpha}`;
const data = async (request: import("@playwright/test").APIRequestContext) => (await request.get(`/api/bootstrap?workspace=${ids.alpha}`)).json();
test("phase15 export requires privileged membership, rejects malformed links and never discloses other projects", async ({ context, browser, db }) => {
  expect((await context.request.get(exportUrl)).status()).toBe(401); await login(context); await data(context.request); const before = await snapshot(db);
  for (const url of ["/api/export", "/api/export?workspace=", `/api/export?workspace=${ids.alpha}&workspace=${ids.beta}`, "/api/export?workspace=..%2Fbeta"]) expect((await context.request.get(url)).status()).toBe(400);
  for (const id of [ids.beta, "ws_not_existing"]) { const response = await context.request.get(`/api/export?workspace=${id}`); expect(response.status()).toBe(404); expect((await response.json()).error).toBe("El proyecto no existe o no tienes acceso."); }
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try { await login(other, users.member); expect((await other.request.get(exportUrl)).status()).toBe(403); await db.collection("memberships").updateOne({ workspaceId: ids.alpha, userId: users.member.id }, { $set: { role: "admin" } }); expect((await other.request.get(exportUrl)).status()).toBe(200); await db.collection("memberships").updateOne({ workspaceId: ids.alpha, userId: users.member.id }, { $set: { role: "member" } }); }
  finally { await other.close(); }
  expect(await snapshot(db)).toEqual(before);
});
test("phase15 export is a coherent no-store download with explicit public fields and no writes", async ({ context, db }) => {
  await login(context); await data(context.request);
  await db.collection("tasks").updateOne({ _id: ids.taskAlpha as never }, { $set: { futureSecret: "must-not-leak", impediment: { reason: "Bloqueo visible", secret: "nested-secret" } } });
  const before = await snapshot(db), response = await context.request.get(exportUrl), text = await response.text(), json = JSON.parse(text);
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("no-store"); expect(response.headers()["content-disposition"]).toBe(`attachment; filename="sprintia-${ids.alpha}.json"`);
  expect(json).toMatchObject({ format: "sprintia-project", version: 1, workspace: { id: ids.alpha }, members: [{ id: users.owner.id }, { id: users.member.id }] });
  expect(json.tasks).toHaveLength(2); expect(json.sprints).toHaveLength(1); expect(json.tasks[0].impediment.reason).toBe("Bloqueo visible");
  expect(text).not.toMatch(/TESTALPHA|TESTBETA|@example|authUserId|inviteCode|futureSecret|must-not-leak|nested-secret|fingerprint|Contenido confidencial/);
  expect(await snapshot(db)).toEqual(before);
});
test("phase15 web export refuses oversized scopes instead of silently truncating", async ({ context, db }) => {
  await login(context); await data(context.request); const source = await db.collection("tasks").findOne({ _id: ids.taskAlpha as never });
  await db.collection("tasks").insertMany(Array.from({ length: 4999 }, (_, i) => ({ ...source, _id: `export_limit_${i}` as never, code: `EXPORT-${i}` })));
  const response = await context.request.get(exportUrl); expect(response.status()).toBe(503); expect(await response.text()).toContain("no se ha descargado un archivo parcial");
});
test("phase15 representative export of 500 tasks is bounded and complete", async ({ context, db }, info) => {
  await login(context); await data(context.request); const source = await db.collection("tasks").findOne({ _id: ids.taskAlpha as never });
  await db.collection("tasks").insertMany(Array.from({ length: 498 }, (_, i) => ({ ...source, _id: `export_perf_${i}` as never, code: `PERF-${i}`, description: "Contenido de ejemplo. ".repeat(10) })));
  await context.request.get(exportUrl); const start = performance.now(), response = await context.request.get(exportUrl), elapsedMs = performance.now() - start, body = await response.body();
  expect(response.status()).toBe(200); expect(JSON.parse(body.toString()).tasks).toHaveLength(500); expect(body.length).toBeLessThan(4 * 1024 * 1024); expect(elapsedMs).toBeLessThan(10_000);
  await info.attach("export-measurement", { body: JSON.stringify({ tasks: 500, bytes: body.length, elapsedMs: Math.round(elapsedMs), environment: "local development, warmed route, not a production SLA" }), contentType: "application/json" });
});
test("phase15 web export enforces its byte budget even below the row limit", async ({ context, db }) => {
  await login(context); await data(context.request); const source = await db.collection("tasks").findOne({ _id: ids.taskAlpha as never });
  await db.collection("tasks").insertMany(Array.from({ length: 1500 }, (_, i) => ({ ...source, _id: `export_bytes_${i}` as never, code: `BYTES-${i}`, description: "Texto privado de ejemplo. ".repeat(120) })));
  const response = await context.request.get(exportUrl); expect(response.status()).toBe(503); expect(await response.text()).toContain("supera 4 MB");
});
test("phase15 settings downloads JSON, recovers network errors and hides the privileged control from members", async ({ page, context }) => {
  await login(context); await page.goto(`/?workspace=${ids.alpha}&view=settings`); const region = page.getByRole("region", { name: "Tu trabajo, también fuera de Sprintia" });
  await page.route("**/api/export?**", (route) => route.fulfill({ status: 503, json: { error: "Error temporal de prueba" } }));
  await region.getByRole("button", { name: "Descargar proyecto · JSON", exact: true }).click(); await expect(region.getByRole("alert")).toContainText("Puedes volver a intentarlo");
  await page.unroute("**/api/export?**"); const download = page.waitForEvent("download"); await region.getByRole("button", { name: "Descargar proyecto · JSON", exact: true }).click(); const result = await download;
  expect(result.suggestedFilename()).toBe(`sprintia-${ids.alpha}.json`); expect(JSON.parse(await readFile((await result.path())!, "utf8")).workspace.id).toBe(ids.alpha); await expect(region.getByRole("status")).toBeVisible();
  await login(context, users.member); await page.reload(); await expect(region.getByRole("button", { name: /Descargar proyecto/ })).toHaveCount(0); await expect(region).toContainText("Solo el propietario");
});
test("phase15 database backup restores all collections, BSON values, history, receipts and indexes only to a new isolated DB", async ({ context, db }) => {
  await login(context); await data(context.request); await mutate(context.request, { action: "createTask", ...base, title: "Tarea que debe recuperarse", points: null });
  const archive = await captureDatabase(db.client, db.databaseName), restored = openArchive(sealArchive(archive, "frase-aislada-de-recuperacion-2026"), "frase-aislada-de-recuperacion-2026");
  const target = `sprintia_restore_${crypto.randomUUID().replaceAll("-", "")}`;
  const result = await restoreDatabase(db.client, target, restored); expect(result.collections).toBe(20);
  for (const name of archiveCollections) {
    expect(await db.client.db(target).collection(name).find({}).sort({ _id: 1 }).toArray()).toEqual(archive.collections[name]);
    const indexes = (await db.client.db(target).collection(name).listIndexes().toArray()).filter((i) => i.name !== "_id_").map(({ v: _v, ns: _ns, ...index }) => { void _v; void _ns; return index; });
    expect(indexes).toEqual(archive.indexes[name]);
    expect((await db.client.db(target).listCollections<CollectionInfo>({ name }).toArray())[0].options).toEqual(archive.options[name]);
  }
  await expect(restoreDatabase(db.client, target, restored)).rejects.toThrow(/vacía/);
  expect(await db.collection("tasks").countDocuments({ title: "Tarea que debe recuperarse" })).toBe(1);
  // Destination lives only in the memory server; its teardown removes it.
});
test("phase15 backup preserves validators and enforces them on the restored collection", async ({ context, db }) => {
  await login(context); await data(context.request);
  await db.command({ collMod: "tasks", validator: { title: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
  try {
    const archive = await captureDatabase(db.client, db.databaseName), target = `sprintia_restore_${crypto.randomUUID().replaceAll("-", "")}`;
    await restoreDatabase(db.client, target, openArchive(sealArchive(archive, "frase-aislada-validadores-2026"), "frase-aislada-validadores-2026"));
    expect((await db.client.db(target).listCollections<CollectionInfo>({ name: "tasks" }).toArray())[0].options).toEqual(archive.options.tasks);
    await expect(db.client.db(target).collection("tasks").insertOne({ title: 123 })).rejects.toThrow();
  } finally { await db.command({ collMod: "tasks", validator: {}, validationLevel: "off" }); }
});
test("phase15 failed restore rolls back every document and never alters the source", async ({ context, db }) => {
  await login(context); await data(context.request); const before = await snapshot(db), archive = await captureDatabase(db.client, db.databaseName);
  archive.indexes.tasks.push({ name: "intentional_restore_failure", key: { workspaceId: 1 }, unique: true });
  const target = `sprintia_restore_${crypto.randomUUID().replaceAll("-", "")}`;
  await expect(restoreDatabase(db.client, target, archive)).rejects.toThrow();
  for (const name of archiveCollections) expect(await db.client.db(target).collection(name).countDocuments()).toBe(0);
  expect(await snapshot(db)).toEqual(before);
});
test("phase15 operator CLI verifies encrypted files, refuses overwrite and restores only an explicit new DB", async ({ context, db }, info) => {
  await login(context); await data(context.request);
  const runtime = JSON.parse(await readFile(new URL("../../.test-runtime.json", import.meta.url), "utf8"));
  const dir = info.outputPath("operator-copy"); await mkdir(dir);
  const file = info.outputPath("operator-copy", "test.sprintia-backup"), target = `sprintia_restore_${crypto.randomUUID().replaceAll("-", "")}`;
  const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/recovery.mjs", ...args], { encoding: "utf8", windowsHide: true, timeout: 20_000, env: { ...process.env, SPRINTIA_RECOVERY_URI: runtime.uri, SPRINTIA_BACKUP_PASSPHRASE: "frase-privada-exclusiva-del-ensayo-local" } });
  const backup = ["backup", "--source-db", db.databaseName, "--confirm", db.databaseName, "--file", file];
  expect(run(...backup).status).toBe(0); const first = await readFile(file); expect(run(...backup).status).toBe(1); expect(await readFile(file)).toEqual(first);
  const verified = run("verify", "--file", file); expect(verified.status).toBe(0); expect(JSON.parse(verified.stdout)).toEqual({ ok: true, verified: true });
  expect(run("restore", "--target-db", target, "--file", file).status).toBe(1);
  const restored = run("restore", "--target-db", target, "--confirm", target, "--file", file); expect(restored.status, restored.stderr).toBe(0); expect(await db.client.db(target).collection("tasks").countDocuments()).toBe(4);
  expect([verified.stdout, restored.stdout, restored.stderr].join("")).not.toContain(runtime.uri);
});
test("phase15 complete Scrum cycle with two people preserves delivery, feedback, improvements and recoverable data", async ({ context, browser, db }) => {
  await login(context); await data(context.request); await db.collection("sprints").updateOne({ _id: ids.sprintAlpha as never }, { $set: { status: "planned" } });
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4317" }); await login(other, users.member);
  const change = async (request: typeof context.request, payload: Record<string, unknown>) => { const response = await mutate(request, { ...base, ...payload }); expect(response.status(), await response.text()).toBe(200); return response.json(); };
  try {
    await change(context.request, { action: "updateScrumConfiguration", governanceRevision: 0, productGoal: "Validar el proyecto con compañeros", definitionOfDone: ["Recorrido probado por el equipo"], productOwnerId: users.owner.id, scrumMasterId: users.member.id, developerIds: [users.owner.id, users.member.id] });
    await change(context.request, { action: "updateSprint", id: ids.sprintAlpha, revision: 0, name: "Ciclo integrado", goal: "Validar entrevistas", taskChanges: [{ id: "task_test_backlog", revision: 0, selected: true }] });
    await change(context.request, { action: "startSprint", id: ids.sprintAlpha, revision: 1 });
    await change(other.request, { action: "updateTask", id: ids.taskAlpha, revision: 0, title: "Entrevista revisada entre dos" });
    expect((await mutate(context.request, { ...base, action: "updateTask", id: ids.taskAlpha, revision: 0, title: "Cambio obsoleto" })).status()).toBe(409);
    await change(other.request, { action: "addTaskComment", id: ids.taskAlpha, text: "Comprobamos la entrevista juntos" });
    await change(context.request, { action: "changeImpediment", id: ids.taskAlpha, revision: 1, operation: "report", reason: "Falta confirmar acceso", ownerId: users.member.id });
    const blocked = (await data(other.request)).tasks.find((t: { id: string }) => t.id === ids.taskAlpha);
    await change(other.request, { action: "changeImpediment", id: ids.taskAlpha, revision: 2, operation: "resolve", impedimentId: blocked.impediment.id, resolution: "Acceso comprobado" });
    await change(other.request, { action: "updateTask", id: ids.taskAlpha, revision: 3, status: "done" });
    await change(other.request, { action: "saveDailyNote", sprintId: ids.sprintAlpha, date: "2026-10-21", revision: 0, text: "Preparar la demostración de entrevistas" });
    let sprint = (await data(context.request)).sprints.find((s: { id: string }) => s.id === ids.sprintAlpha);
    await change(context.request, { action: "saveSprintReview", sprintId: ids.sprintAlpha, revision: 0, sprintRevision: sprint.revision, governanceRevision: 1, summary: "Entrevista validada por el equipo", taskIds: [ids.taskAlpha], evidence: [], verified: true });
    await change(other.request, { action: "addReviewEntry", sprintId: ids.sprintAlpha, kind: "decision", text: "Ampliar la muestra de entrevistas" });
    const review = await (await context.request.get(`/api/review?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`)).json();
    await change(context.request, { action: "convertReviewDecision", sprintId: ids.sprintAlpha, entryId: review.entries[0].id, title: "Ampliar entrevistas", description: "Acuerdo de la Review" });
    await change(other.request, { action: "addRetroObservation", sprintId: ids.sprintAlpha, kind: "problem", text: "Confirmamos accesos demasiado tarde" });
    const retro = await (await context.request.get(`/api/retro?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`)).json(), observation = retro.observations[0];
    await change(context.request, { action: "selectRetroProblem", sprintId: ids.sprintAlpha, id: observation.id, revision: 0, selected: true });
    const next = await change(context.request, { action: "createSprint", name: "Siguiente ciclo", goal: "Revisar la mejora" });
    const improvement = { title: "Comprobar accesos antes del inicio", measure: "Ambas personas acceden el primer día", ownerId: users.member.id, targetSprintId: next.sprintId };
    const action = await change(context.request, { action: "createRetroAction", sprintId: ids.sprintAlpha, observationId: observation.id, observationRevision: 1, ...improvement });
    sprint = (await data(context.request)).sprints.find((s: { id: string }) => s.id === ids.sprintAlpha);
    await change(context.request, { action: "closeSprint", id: ids.sprintAlpha, revision: sprint.revision, governanceRevision: 1, reviewed: true, summary: "Una entrevista validada y un elemento pendiente para adaptar" });
    await change(other.request, { action: "updateRetroAction", sprintId: ids.sprintAlpha, id: action.retroActionId, revision: 0, ...improvement, status: "done", verified: true, note: "Ambas personas pudieron acceder durante la comprobación" });
    const report = await (await context.request.get(`/api/reports?workspace=${ids.alpha}&sprint=${ids.sprintAlpha}`)).json(); expect(report.coverage).toBe("complete"); expect(report.current.done.tasks).toBe(1); expect(report.current.pending.tasks).toBe(1);
    const exported = await (await context.request.get(exportUrl)).json(); expect(exported.sprints.find((s: { id: string }) => s.id === ids.sprintAlpha).outcome.tasks.filter((t: { returnedToBacklog: boolean }) => t.returnedToBacklog)).toHaveLength(1); expect(exported.review_entries[0].backlogTask).not.toBeNull(); expect(exported.retro_actions[0].status).toBe("done");
    const archive = await captureDatabase(db.client, db.databaseName); expect(archive.collections.mutation_receipts.length).toBeGreaterThan(15); expect(archive.collections.review_revisions).toHaveLength(1);
  } finally { await other.close(); }
});
for (const [width, theme] of [[320, "dark"], [390, "light"], [1107, "dark"]] as const) test(`phase14 visual chat relief, focus and exit at ${width}px without AI requests`, async ({ page, context }) => {
  await login(context); await page.setViewportSize({ width, height: 958 }); await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z"));
  await page.addInitScript(({ theme }) => { localStorage.setItem("sprintia-theme", theme); localStorage.setItem("sprintia-text-size", "large"); }, { theme });
  let aiCalls = 0; page.on("request", (request) => { if (request.url().includes("/api/ai")) aiCalls++; });
  await page.goto(`/?workspace=${ids.alpha}`); const launcher = page.getByRole("button", { name: /Abrir copiloto/ }); await launcher.click();
  const panel = page.getByRole("dialog", { name: "Sprintia Copiloto" }); await expect(panel).toBeVisible(); const textarea = panel.getByLabel("Mensaje para Sprintia Copiloto");
  await textarea.fill("Borrador de prueba\ncon dos líneas y sin enviarlo."); await expect(textarea).toHaveCSS("resize", "none");
  expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1); expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await panel.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("*")).filter((node) => node.getClientRects().length && Array.from(node.childNodes).some((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim()) && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.textContent))).toEqual([]);
  await expect(panel).toHaveScreenshot(`chat-neumorphism-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
  await panel.getByRole("button", { name: "Cerrar copiloto" }).click(); await expect(panel).toHaveCount(0); await expect(launcher).toBeFocused(); await launcher.click(); await expect(textarea).toHaveValue("Borrador de prueba\ncon dos líneas y sin enviarlo.");
  await page.emulateMedia({ reducedMotion: "reduce" }); await expect.poll(() => panel.evaluate((el) => el.getAnimations().length)).toBe(0); await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0); expect(aiCalls).toBe(0);
});
test("phase15 export settings fit mobile with readable neumorphic content", async ({ page, context }) => {
  await login(context); await page.setViewportSize({ width: 390, height: 958 }); await page.addInitScript(() => { localStorage.setItem("sprintia-theme", "dark"); localStorage.setItem("sprintia-text-size", "xlarge"); });
  await page.goto(`/?workspace=${ids.alpha}&view=settings`); const section = page.getByRole("region", { name: "Tu trabajo, también fuera de Sprintia" }); await section.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1); await expect(section).toHaveScreenshot("project-export-mobile.png", { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
});
