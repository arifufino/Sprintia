import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";

const taskChange = (patch: Record<string, unknown> = {}) => ({ action: "updateTask", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 0, ...patch });
const creation = (patch: Record<string, unknown> = {}) => ({ action: "createTask", workspaceId: ids.alpha, title: "Cambio compartido", sprintId: ids.sprintAlpha, status: "todo", ...patch });

test("legacy projects expose revision zero without fabricating history", async ({ context, db }) => {
  await login(context);
  const data = await (await context.request.get(`/api/bootstrap?workspace=${ids.alpha}`)).json();
  expect(data.tasks.every((task: { revision: number }) => task.revision === 0)).toBe(true);
  expect(data.sprints[0].revision).toBe(0);
  expect(data.members.every((member: { accessRevision: number }) => member.accessRevision === 0)).toBe(true);
  expect(await db.collection("activities").countDocuments()).toBe(0);
  expect(await db.collection("tasks").countDocuments({ revision: { $exists: true } })).toBe(0);
});

test("explicit patches preserve other fields and record actor, version and before/after", async ({ context, db }) => {
  await login(context);
  const before = await db.collection("tasks").findOne({ _id: ids.taskAlpha as never });
  expect((await mutate(context.request, taskChange({ title: "Título nuevo" }))).status()).toBe(200);
  const task = await db.collection("tasks").findOne({ _id: ids.taskAlpha as never });
  expect(task).toMatchObject({ ...before, title: "Título nuevo", revision: 1, updatedAt: task?.updatedAt });
  const event = await db.collection("activities").findOne({ "event.type": "task.updated" });
  expect(event).toMatchObject({ workspaceId: ids.alpha, userId: users.owner.id, actorName: users.owner.name,
    event: { entityId: ids.taskAlpha, entityRevision: 1, changes: { title: { before: before?.title, after: "Título nuevo" } } } });
  expect(Object.keys(event!.event.changes)).toEqual(["title"]);
  expect(Number.isNaN(Date.parse(event!.createdAt))).toBe(false);
  const noOp = await mutate(context.request, taskChange({ revision: 1, title: "Título nuevo" }));
  expect(noOp.status()).toBe(200);
  expect(await db.collection("activities").countDocuments()).toBe(1);
});

test("two independent sessions cannot overwrite the same version", async ({ browser, context, db }) => {
  await login(context);
  const second = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try {
    await login(second, users.member);
    const results = await Promise.all([
      mutate(context.request, taskChange({ title: "Edición de Ana" })),
      mutate(second.request, taskChange({ description: "Edición de Bruno" })),
    ]);
    expect(results.map((result) => result.status()).sort()).toEqual([200, 409]);
    expect(await db.collection("activities").countDocuments()).toBe(1);
    expect(await db.collection("mutation_receipts").countDocuments()).toBe(1);
    expect(await db.collection("tasks").findOne({ _id: ids.taskAlpha as never })).toMatchObject({ revision: 1 });
    const losingPayload = results[0].status() === 409 ? { title: "Edición de Ana" } : { description: "Edición de Bruno" };
    expect((await mutate(context.request, taskChange({ ...losingPayload, revision: 1 }))).status()).toBe(200);
    expect(await db.collection("tasks").findOne({ _id: ids.taskAlpha as never })).toMatchObject({ title: "Edición de Ana", description: "Edición de Bruno", revision: 2 });
  } finally { await second.close(); }
});

test("missing/invalid/stale versions and a stale deletion leave no effects", async ({ context, db }) => {
  await login(context);
  for (const revision of [undefined, null, -1, 1.5, "0", Number.MAX_SAFE_INTEGER + 1]) {
    expect((await mutate(context.request, taskChange({ revision, title: "Invalid" }))).status()).toBe(400);
  }
  expect((await mutate(context.request, taskChange({ points: 5 }))).status()).toBe(200);
  const after = await snapshot(db);
  expect((await mutate(context.request, { action: "deleteTask", workspaceId: ids.alpha, id: ids.taskAlpha, revision: 0 })).status()).toBe(409);
  expect((await mutate(context.request, taskChange({ status: "done" }))).status()).toBe(409);
  expect(await snapshot(db)).toEqual(after);
});

for (const action of ["createTask", "createSprint", "createWorkspace"] as const) {
  test(`concurrent and later retries of ${action} commit exactly once`, async ({ context, db }) => {
    await login(context);
    await context.request.get(`/api/bootstrap?workspace=${ids.alpha}`);
    const mutationId = crypto.randomUUID();
    const payload = action === "createTask" ? creation({ mutationId }) : { action, workspaceId: ids.alpha, name: "Una sola creación", mutationId };
    const responses = await Promise.all([mutate(context.request, payload), mutate(context.request, payload)]);
    expect(responses.map((response) => response.status())).toEqual([200, 200]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    const before = await snapshot(db);
    expect((await mutate(context.request, payload)).status()).toBe(200);
    expect(await snapshot(db)).toEqual(before);
    expect(await db.collection("mutation_receipts").countDocuments()).toBe(1);
    expect(await db.collection("activities").countDocuments()).toBe(1);
    expect((await mutate(context.request, { ...payload, name: "Otro contenido" })).status()).toBe(409);
    expect(await snapshot(db)).toEqual(before);
  });
}

test("delete retry acknowledges the committed removal without a second event", async ({ context, db }) => {
  await login(context);
  const payload = { action: "deleteTask", workspaceId: ids.alpha, id: ids.taskAlpha, mutationId: crypto.randomUUID() };
  expect((await mutate(context.request, payload)).status()).toBe(200);
  expect((await mutate(context.request, payload)).status()).toBe(200);
  expect(await db.collection("activities").countDocuments({ "event.type": "task.deleted" })).toBe(1);
  expect(await db.collection("tasks").countDocuments({ _id: ids.taskAlpha as never })).toBe(0);
});

test("receipt replay reauthorizes access and never reveals another actor's result", async ({ context, db }) => {
  await login(context, users.member);
  const payload = creation({ mutationId: crypto.randomUUID() });
  expect((await mutate(context.request, payload)).status()).toBe(200);
  await db.collection("memberships").deleteOne({ workspaceId: ids.alpha, userId: users.member.id });
  expect((await mutate(context.request, payload)).status()).toBe(403);
  await login(context, users.outsider);
  expect((await mutate(context.request, payload)).ok()).toBe(false);
  expect(await db.collection("mutation_receipts").countDocuments()).toBe(1);
});

test("event insertion failure rolls back entity, counter and receipt together", async ({ context, db }) => {
  await login(context);
  await context.request.get(`/api/bootstrap?workspace=${ids.alpha}`);
  const before = await snapshot(db);
  const payload = creation({ mutationId: crypto.randomUUID() });
  await db.command({ collMod: "activities", validator: { "event.type": { $exists: false } }, validationLevel: "strict", validationAction: "error" });
  try {
    expect((await mutate(context.request, payload)).status()).toBe(500);
    expect(await snapshot(db)).toEqual(before);
  } finally { await db.command({ collMod: "activities", validator: {} }); }
  expect((await mutate(context.request, payload)).status()).toBe(200);
  expect(await db.collection("tasks").findOne({ title: "Cambio compartido" })).toMatchObject({ code: "UNI-03", revision: 0 });
});

test("access revisions detect ABA and invitation events omit credentials", async ({ context, db }) => {
  await login(context);
  const access = { action: "updateMemberAccess", workspaceId: ids.alpha, userId: users.member.id, role: "admin", expectedRole: "member", accessRevision: 0 };
  expect((await mutate(context.request, access)).status()).toBe(200);
  expect((await mutate(context.request, { ...access, role: "member", expectedRole: "admin", accessRevision: 1 })).status()).toBe(200);
  expect((await mutate(context.request, access)).status()).toBe(409);
  expect((await mutate(context.request, { action: "manageInvitation", workspaceId: ids.alpha, operation: "rotate", invitationRevision: 0 })).status()).toBe(200);
  const workspace = await db.collection("workspaces").findOne({ _id: ids.alpha as never });
  const audit = JSON.stringify(await db.collection("activities").find().toArray());
  expect(audit).not.toContain("TESTALPHA1234567");
  expect(audit).not.toContain(workspace!.inviteCode);
});

test("ETag checks authorization before 304 and changes after a mutation", async ({ context, db }) => {
  await login(context, users.member);
  const url = `/api/bootstrap?workspace=${ids.alpha}`;
  const first = await context.request.get(url);
  const etag = first.headers().etag;
  expect(etag).toBeTruthy();
  expect((await context.request.get(url, { headers: { "If-None-Match": etag } })).status()).toBe(304);
  expect((await mutate(context.request, taskChange({ title: "Otra versión" }))).status()).toBe(200);
  const changed = await context.request.get(url, { headers: { "If-None-Match": etag } });
  expect(changed.status()).toBe(200);
  expect(changed.headers().etag).not.toBe(etag);
  await db.collection("memberships").deleteOne({ workspaceId: ids.alpha, userId: users.member.id });
  expect((await context.request.get(url, { headers: { "If-None-Match": changed.headers().etag } })).status()).toBe(404);
});

test("editor preserves a stale draft, compares current values and explicitly reloads", async ({ page, context, db }) => {
  await login(context); await page.goto(`/?workspace=${ids.alpha}&task=${ids.taskAlpha}`);
  const dialog = page.getByRole("dialog", { name: "UNI-01", exact: true });
  await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Mi borrador local");
  expect((await mutate(context.request, taskChange({ title: "Título del compañero", description: "Contexto compartido nuevo" }))).status()).toBe(200);
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog.getByLabel("Conflicto de tarea")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Mi borrador local");
  await expect(dialog.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  await dialog.getByText("Comparar con la versión actual").click();
  await expect(dialog.getByText("Título del compañero", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cargar versión actual" }).click();
  await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Título del compañero");
  await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Acuerdo final");
  const request = page.waitForRequest((request) => request.url().includes("/api/mutate") && request.method() === "POST");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  expect((await request).postDataJSON()).toMatchObject({ revision: 1, title: "Acuerdo final" });
  expect((await request).postDataJSON()).not.toHaveProperty("description");
  await expect(dialog).toHaveCount(0);
  expect(await db.collection("tasks").findOne({ _id: ids.taskAlpha as never })).toMatchObject({ title: "Acuerdo final", description: "Contexto compartido nuevo", revision: 2 });
});

test("remote deletion preserves the open draft across repeated refreshes", async ({ page, context }) => {
  await login(context); await page.goto(`/?workspace=${ids.alpha}&task=${ids.taskAlpha}`);
  const dialog = page.getByRole("dialog", { name: "UNI-01", exact: true });
  await dialog.getByRole("textbox", { name: "Descripción", exact: true }).fill("No perder este texto");
  expect((await mutate(context.request, { action: "deleteTask", workspaceId: ids.alpha, id: ids.taskAlpha })).status()).toBe(200);
  for (let index = 0; index < 2; index++) {
    const response = page.waitForResponse((response) => response.url().includes("/api/bootstrap"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await response;
    await expect(dialog.getByText("Esta tarea ya no está disponible")).toBeVisible();
  }
  await expect(dialog.getByRole("textbox", { name: "Descripción", exact: true })).toHaveValue("No perder este texto");
  await expect(dialog.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tablero", exact: true })).toBeVisible();
});

test("lost success response retries the same intent once, even after closing its dialog", async ({ page, context, db }) => {
  await login(context); await page.goto("/");
  const keys: string[] = [];
  await page.route("**/api/mutate", async (route) => {
    keys.push(route.request().postDataJSON().mutationId);
    if (keys.length === 1) { await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "+ Nueva tarea", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva tarea" });
  await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Respuesta perdida");
  await dialog.getByRole("button", { name: "Crear tarea", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("No pudimos confirmar");
  await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Respuesta perdida");
  await expect(dialog.getByRole("button", { name: "Crear tarea", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cerrar ventana" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Reintentar cambio pendiente", exact: true }).click();
  await expect(page.getByLabel("Estado de sincronización")).toContainText("Actualizado");
  expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
  expect(await db.collection("tasks").countDocuments({ title: "Respuesta perdida" })).toBe(1);
  expect(await db.collection("activities").countDocuments({ "event.type": "task.created" })).toBe(1);
});

test("offline and focus refresh expose truthful status without losing filters", async ({ page, context }) => {
  await login(context); await page.goto(`/?workspace=${ids.alpha}&q=Alfa`);
  const status = page.getByLabel("Estado de sincronización");
  await expect(status).toContainText("Actualizado");
  await context.setOffline(true);
  await expect(status).toContainText("Sin conexión");
  await expect(status.getByRole("button", { name: "Actualizar", exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect(status).toContainText("Actualizado");
  expect((await mutate(context.request, taskChange({ title: "Alfa sincronizado" }))).status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Alfa sincronizado" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe("Alfa");
});

test("invalid operation identifiers cannot write and concurrent distinct creations get unique codes", async ({ context, db }) => {
  await login(context);
  for (const mutationId of [undefined, "", "../../other", 5]) expect((await mutate(context.request, creation({ mutationId }))).status()).toBe(400);
  expect(await db.collection("mutation_receipts").countDocuments()).toBe(0);
  const responses = await Promise.all(Array.from({ length: 4 }, (_, index) => mutate(context.request, creation({ title: `Creación ${index}` }))));
  expect(responses.every((response) => response.status() === 200)).toBe(true);
  const tasks = await db.collection("tasks").find({ title: /^Creación/ }).toArray();
  expect(tasks.map((task) => task.code).sort()).toEqual(["UNI-03", "UNI-04", "UNI-05", "UNI-06"]);
  expect(await db.collection("activities").countDocuments()).toBe(4);
});

test("failed optimistic move restores confirmed data even when refresh also fails", async ({ page, context, db }) => {
  await login(context); await page.goto("/");
  const card = page.getByRole("article", { name: "UNI-01: Preparar entrevista Alfa", exact: true });
  await expect(card).toBeVisible();
  await page.route("**/api/mutate", (route) => route.fulfill({ status: 503, json: { error: "Servidor temporalmente no disponible" } }));
  await page.route("**/api/bootstrap**", (route) => route.abort("failed"));
  await card.getByRole("combobox", { name: "Mover UNI-01", exact: true }).selectOption("progress");
  await expect(page.getByLabel("Estado de sincronización")).toContainText("Cambio sin confirmar");
  await expect(page.locator(".column-todo").getByRole("heading", { name: "Preparar entrevista Alfa" })).toBeVisible();
  await expect(page.locator(".column-progress").getByRole("heading", { name: "Preparar entrevista Alfa" })).toHaveCount(0);
  expect(await db.collection("tasks").findOne({ _id: ids.taskAlpha as never })).toMatchObject({ status: "todo" });
  expect(await db.collection("mutation_receipts").countDocuments()).toBe(0);
});

test("pre-mutation refresh cannot restore an older task after a successful move", async ({ page, context }) => {
  await login(context); await page.goto("/");
  const card = page.getByRole("article", { name: "UNI-01: Preparar entrevista Alfa", exact: true });
  await expect(card).toBeVisible();
  let release!: () => void;
  let fetched!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const captured = new Promise<void>((resolve) => { fetched = resolve; });
  let count = 0;
  await page.route("**/api/bootstrap**", async (route) => {
    if (++count !== 1) { await route.continue(); return; }
    const response = await route.fetch({ headers: { ...route.request().headers(), "if-none-match": "" } });
    fetched(); await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByLabel("Estado de sincronización").getByRole("button", { name: "Actualizar", exact: true }).click();
  await captured;
  await card.getByRole("combobox", { name: "Mover UNI-01", exact: true }).selectOption("progress");
  await expect(page.getByLabel("Estado de sincronización")).toContainText("Actualizado");
  release();
  await expect(page.locator(".column-progress").getByRole("heading", { name: "Preparar entrevista Alfa" })).toBeVisible();
  await expect(page.locator(".column-todo").getByRole("heading", { name: "Preparar entrevista Alfa" })).toHaveCount(0);
});

for (const width of [390, 1107]) {
  test(`conflict panel stays readable and fits at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 958 });
    await page.addInitScript(() => localStorage.setItem("sprintia-text-size", "xlarge"));
    await page.clock.setFixedTime(new Date("2026-10-12T15:00:00.000Z"));
    await login(context); await page.goto(`/?workspace=${ids.alpha}&task=${ids.taskAlpha}`);
    const dialog = page.getByRole("dialog", { name: "UNI-01", exact: true });
    await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Mi propuesta");
    await mutate(context.request, taskChange({ title: "Propuesta compartida", description: "Un contexto nuevo que hay que revisar con el equipo." }));
    await dialog.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(dialog.getByLabel("Conflicto de tarea")).toBeVisible();
    await dialog.getByText("Comparar con la versión actual").click();
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    // Compare the same reading position, independent of the browser's scroll
    // anchoring when validation inserts content above the focused Save control.
    await page.evaluate(() => document.fonts.ready);
    await dialog.evaluate((element) => { element.scrollTop = 0; });
    await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(page).toHaveScreenshot(`phase-7-conflict-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
  });
}
