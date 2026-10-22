import type { Page } from "@playwright/test";
import type { Document } from "mongodb";
import { test, expect, ids, users, login, mutate } from "./fixtures";

const settingsUrl = `/?workspace=${ids.alpha}&view=settings`;
async function openSettings(page: Page) {
  await page.goto(settingsUrl);
  await page.addStyleTag({ path: "tests/e2e/screenshot.css" });
  await expect(page.getByRole("heading", { name: "Configuración", exact: true })).toBeVisible();
}
const config = (productGoal: string) => ({ action: "updateScrumConfiguration", workspaceId: ids.alpha, governanceRevision: 0, productGoal, definitionOfDone: ["Pruebas superadas"], productOwnerId: users.owner.id, scrumMasterId: users.member.id, developerIds: [users.member.id] });

test("acuerdos guardados desde el formulario sobreviven a recarga y se comparten en solo lectura", async ({ page, context, browser, db }) => {
  await login(context); await openSettings(page);
  const trigger = page.getByRole("button", { name: "Editar configuración Scrum" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Configuración Scrum" });
  const goal = dialog.getByRole("textbox", { name: "Objetivo del producto", exact: true });
  await expect(goal).toBeFocused();
  await expect(dialog.getByRole("combobox", { name: "Scrum Master", exact: true })).toHaveValue("");
  await goal.fill("Reducir el tiempo de planificación del equipo");
  await dialog.getByRole("textbox", { name: "Definition of Done", exact: true }).fill("Pruebas acordadas superadas\nDocumentación compartida");
  await dialog.getByRole("combobox", { name: "Product Owner", exact: true }).selectOption(users.owner.id);
  await dialog.getByRole("combobox", { name: "Scrum Master", exact: true }).selectOption(users.member.id);
  await dialog.getByRole("checkbox", { name: users.member.name }).check();
  await dialog.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await page.reload();
  const agreements = page.getByRole("region", { name: "Configuración Scrum", exact: true });
  await expect(agreements).toContainText("Reducir el tiempo de planificación del equipo");
  await expect(agreements).toContainText("Documentación compartida");
  expect(await db.collection("memberships").findOne({ userId: users.member.id, workspaceId: ids.alpha })).toMatchObject({ role: "member" });
  const guest = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try {
    await login(guest, users.member);
    const memberPage = await guest.newPage(); await openSettings(memberPage);
    await expect(memberPage.getByRole("region", { name: "Configuración Scrum", exact: true })).toContainText("Documentación compartida");
    await expect(memberPage.getByRole("button", { name: "Editar configuración Scrum" })).toHaveCount(0);
    await expect(memberPage.getByText("Solo lectura", { exact: true })).toBeVisible();
    await memberPage.goto(`/?workspace=${ids.alpha}&view=team`);
    const card = memberPage.getByRole("article", { name: users.member.name, exact: true });
    await expect(card).toContainText("Scrum Master"); await expect(card).toContainText("Developer");
    await expect(memberPage.getByRole("button", { name: /Invitar|Gestionar invitación|Editar acceso|Editar responsabilidades/ })).toHaveCount(0);
    await expect(memberPage.getByRole("button", { name: "+ Nueva tarea", exact: true })).toBeEnabled();
  } finally { await guest.close(); }
});

test("propietario modifica acceso con explicación; administrador no puede modificar permisos", async ({ page, context, browser, db }) => {
  await login(context);
  expect((await mutate(context.request, config("Objetivo compartido"))).status()).toBe(200);
  await page.goto(`/?workspace=${ids.alpha}&view=team`);
  const trigger = page.getByRole("button", { name: `Editar acceso de ${users.member.name}` });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Acceso al proyecto" });
  await dialog.getByRole("combobox", { name: "Nivel de acceso" }).selectOption("admin");
  await expect(dialog).toContainText("No podrá cambiar permisos");
  await dialog.getByRole("button", { name: "Guardar acceso" }).click();
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(page.getByRole("article", { name: users.member.name, exact: true })).toContainText("Administrador");
  await expect(page.getByRole("article", { name: users.member.name, exact: true })).toContainText("Scrum Master");
  const admin = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
  try {
    await login(admin, users.member);
    const adminPage = await admin.newPage();
    await adminPage.goto(`/?workspace=${ids.alpha}&view=team`);
    await expect(adminPage.getByRole("button", { name: "Editar responsabilidades Scrum" })).toBeVisible();
    await expect(adminPage.getByRole("button", { name: /Editar acceso/ })).toHaveCount(0);
    await expect(adminPage.getByRole("button", { name: "Invitar", exact: true })).toBeVisible();
    await trigger.click();
    await dialog.getByRole("combobox", { name: "Nivel de acceso" }).selectOption("member");
    await dialog.getByRole("button", { name: "Guardar acceso" }).click();
    await expect(dialog).toHaveCount(0);
    await adminPage.reload();
    await expect(adminPage.getByRole("button", { name: "Invitar", exact: true })).toHaveCount(0);
    await expect(adminPage.getByRole("article", { name: users.member.name, exact: true })).toContainText("Scrum Master");
    expect(await db.collection("memberships").findOne({ workspaceId: ids.alpha, userId: users.member.id })).toMatchObject({ role: "member" });
  } finally { await admin.close(); }
});

test("renovación y revocación requieren confirmación y el diálogo refleja el estado persistido", async ({ page, context, db }) => {
  await login(context); await page.goto("/");
  await page.getByRole("button", { name: "Invitar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Invitar al equipo" });
  await dialog.getByRole("button", { name: "Revocar invitación", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancelar cambio" }).click();
  expect((await db.collection("workspaces").findOne({ inviteCode: "TESTALPHA1234567" }))?.inviteEnabled).toBe(true);
  await dialog.getByRole("button", { name: "Renovar invitación", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirmar nueva invitación" }).click();
  await expect(dialog.getByRole("button", { name: "Renovar invitación", exact: true })).toBeVisible();
  await expect(dialog.locator("code")).not.toHaveText("TESTALPHA1234567");
  await dialog.getByRole("button", { name: "Revocar invitación", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirmar revocación" }).click();
  await expect(dialog.getByText("Invitaciones desactivadas", { exact: true })).toBeVisible();
  await expect(dialog.locator("code")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Copiar enlace" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Listo", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload(); await page.getByRole("button", { name: "Invitar", exact: true }).click();
  await expect(dialog.getByText("Invitaciones desactivadas", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Crear nueva invitación" }).click();
  await dialog.getByRole("button", { name: "Confirmar nueva invitación" }).click();
  await expect(dialog.getByRole("button", { name: "Copiar enlace" })).toBeVisible();
});

test("configuración concurrente conserva borrador y permite revisar la versión actual", async ({ page, context }) => {
  await login(context); await openSettings(page);
  await page.getByRole("button", { name: "Editar configuración Scrum" }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración Scrum" });
  const goal = dialog.getByRole("textbox", { name: "Objetivo del producto", exact: true });
  await goal.fill("Mi borrador local");
  expect((await mutate(context.request, config("Cambio de otra sesión"))).status()).toBe(200);
  await dialog.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(dialog.getByRole("alert")).toContainText("La configuración cambió");
  await expect(goal).toHaveValue("Mi borrador local");
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Editar configuración Scrum" }).click();
  await expect(goal).toHaveValue("Cambio de otra sesión");
});

test("revocar permiso mientras el editor está abierto no permite guardar ni descarta el borrador", async ({ page, context, db }) => {
  const collection = db.collection<Document & { _id: string }>("memberships");
  await collection.updateOne({ workspaceId: ids.alpha, userId: users.member.id }, { $set: { role: "admin" } });
  await login(context, users.member); await openSettings(page);
  await page.getByRole("button", { name: "Editar configuración Scrum" }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración Scrum" });
  await dialog.getByRole("textbox", { name: "Objetivo del producto", exact: true }).fill("Borrador con permiso anterior");
  await collection.updateOne({ workspaceId: ids.alpha, userId: users.member.id }, { $set: { role: "member" } });
  await dialog.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(dialog.getByRole("alert")).toContainText("No tienes permiso");
  await expect(dialog.getByRole("textbox", { name: "Objetivo del producto", exact: true })).toHaveValue("Borrador con permiso anterior");
});

for (const width of [320, 390, 1107]) {
  test(`configuración y permisos adaptables a ${width}px, tipografía legible y salida accesible`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 958 });
    await page.addInitScript((size) => { localStorage.setItem("sprintia-text-size", size); localStorage.setItem("sprintia-theme", size === "small" ? "light" : "dark"); }, width === 320 ? "small" : "xlarge");
    await login(context); await openSettings(page);
    const trigger = page.getByRole("button", { name: "Editar configuración Scrum" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Configuración Scrum" });
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const tiny = await dialog.evaluate((element) => Array.from(element.querySelectorAll<HTMLElement>("*"))
      .filter((item) => item.getClientRects().length && Array.from(item.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) && parseFloat(getComputedStyle(item).fontSize) < 12)
      .map((item) => item.tagName));
    expect(tiny).toEqual([]);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`phase-6-scrum-${width}.png`, { animations: "disabled", stylePath: "tests/e2e/screenshot.css" });
    await page.screenshot({ path: testInfo.outputPath("scrum-review.png"), animations: "disabled" });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await trigger.click(); await dialog.getByRole("button", { name: "Cerrar ventana" }).click();
    await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
    await page.goto(`/?workspace=${ids.alpha}&view=team`);
    await page.getByRole("button", { name: `Editar acceso de ${users.member.name}` }).click();
    const access = page.getByRole("dialog", { name: "Acceso al proyecto" });
    await expect(access).toBeVisible();
    expect(await access.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape"); await expect(access).toHaveCount(0);
  });
}
