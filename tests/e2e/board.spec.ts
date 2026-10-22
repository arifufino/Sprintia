import { test, expect, ids, users, login } from "./fixtures";

test.beforeEach(async ({ context, page }) => {
  await login(context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tablero", exact: true })).toBeVisible();
});

test("carga y cambia entre proyectos permitidos sin mezclar sus tareas", async ({ page }) => {
  const picker = page.getByRole("combobox", { name: "Cambiar espacio de trabajo" });
  await expect(picker).toHaveValue(ids.alpha);
  await expect(picker.locator("option")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Preparar entrevista Alfa" })).toBeVisible();
  await picker.selectOption(ids.gamma);
  await expect(page.getByRole("heading", { name: "Preparar informe Gamma" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preparar entrevista Alfa" })).toHaveCount(0);
  await expect(page.getByText("Contenido confidencial Beta")).toHaveCount(0);
  await picker.selectOption(ids.alpha);
  await expect(page.getByRole("heading", { name: "Preparar entrevista Alfa" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preparar informe Gamma" })).toHaveCount(0);
});

test("crea y mueve una tarea desde la interfaz; persiste y la ve otro miembro", async ({ page, browser, db }) => {
  await page.getByRole("button", { name: "+ Nueva tarea", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva tarea" });
  await dialog.getByLabel("Título", { exact: true }).fill("Validar prototipo con el equipo");
  await dialog.getByLabel("Descripción", { exact: true }).fill("Probar el flujo y documentar los resultados.");
  await dialog.getByRole("combobox", { name: "Prioridad", exact: true }).selectOption("high");
  await dialog.getByRole("button", { name: "Crear tarea", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const title = "Validar prototipo con el equipo";
  await expect(page.locator(".column-todo").getByRole("heading", { name: title })).toBeVisible();
  await page.reload();
  const card = page.getByRole("article", { name: `UNI-03: ${title}`, exact: true });
  await expect(card).toBeVisible();
  await card.getByRole("combobox", { name: "Mover UNI-03", exact: true }).selectOption("progress");
  await expect.poll(async () => (await db.collection("tasks").findOne({ title }))?.status).toBe("progress");
  await page.reload();
  await expect(page.locator(".column-progress").getByRole("heading", { name: title })).toBeVisible();
  const task = await db.collection("tasks").findOne({ title });
  expect(task).toMatchObject({ workspaceId: ids.alpha, sprintId: ids.sprintAlpha, status: "progress", priority: "high", reporterId: users.owner.id });
  expect(await db.collection("tasks").countDocuments({ title })).toBe(1);
  const memberContext = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try {
    await login(memberContext, users.member);
    const memberPage = await memberContext.newPage();
    await memberPage.goto("/");
    await expect(memberPage.locator(".column-progress").getByRole("heading", { name: title })).toBeVisible();
    await memberPage.getByRole("combobox", { name: "Mover UNI-03", exact: true }).selectOption("done");
    await expect.poll(async () => (await db.collection("tasks").findOne({ title }))?.status).toBe("done");
    await page.reload();
    await expect(page.locator(".column-done").getByRole("heading", { name: title })).toBeVisible();
  } finally { await memberContext.close(); }
});

test("el arrastre entre columnas se guarda y sobrevive a una recarga", async ({ page, db }) => {
  const card = page.getByRole("article", { name: "UNI-01: Preparar entrevista Alfa", exact: true });
  await expect(card).toBeVisible();
  // Let all nested/ancestor entry motion finish before pressing the mouse:
  // a stable card can still move while its animated column is entering.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => undefined)));
  });
  // Start on the non-interactive card header and aim at the visible drop area.
  // Centering a tall column can scroll between mouse-down and drag-start.
  await card.dragTo(page.locator(".column-review .column-empty"), { sourcePosition: { x: 20, y: 20 } });
  await expect.poll(async () => (await db.collection("tasks").findOne({ title: "Preparar entrevista Alfa" }))?.status).toBe("review");
  await page.reload();
  await expect(page.locator(".column-review").getByRole("heading", { name: "Preparar entrevista Alfa" })).toBeVisible();
});
