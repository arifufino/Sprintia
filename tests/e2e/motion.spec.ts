import type { Locator, Page } from "@playwright/test";
import { test, expect, login, ids } from "./fixtures";

async function board(page: Page) {
  await page.goto("/");
  await page.addStyleTag({ path: "tests/e2e/screenshot.css" });
  await expect(page.getByRole("heading", { name: "Preparar entrevista Alfa" })).toBeVisible();
}

// Freeze real exit animations at their first frame, rather than asserting timing with sleeps.
async function captureExit(surface: Locator) {
  await surface.evaluate((element) => {
    const observer = new MutationObserver(() => {
      if (element.getAttribute("data-motion") !== "closing") return;
      element.getAnimations({ subtree: true }).filter((animation) => animation.effect instanceof KeyframeEffect
        && (animation.effect.target === element || (animation.effect.target instanceof Element && animation.effect.target.hasAttribute("data-overlay-surface"))))
        .forEach((animation) => animation.pause());
      element.setAttribute("data-exit-captured", "true");
      observer.disconnect();
    });
    observer.observe(element, { attributes: true, attributeFilter: ["data-motion"] });
  });
}
async function finishExit(surface: Locator) {
  await expect(surface).toHaveAttribute("data-exit-captured", "true");
  const animations = await surface.evaluate((element) => {
    const animations = element.getAnimations({ subtree: true }).filter((animation) => animation.effect instanceof KeyframeEffect
      && (animation.effect.target === element || (animation.effect.target instanceof Element && animation.effect.target.hasAttribute("data-overlay-surface"))));
    const names = animations.filter((animation) => animation instanceof CSSAnimation).map((animation) => (animation as CSSAnimation).animationName);
    animations.forEach((animation) => animation.finish());
    return names;
  });
  expect(animations.length).toBeGreaterThan(0);
}

const dialogs = [
  { title: "Nueva tarea", trigger: "+ Nueva tarea", cancel: "Cancelar" },
  { title: "Invitar al equipo", trigger: "Invitar", cancel: "Listo" },
  { title: "Crear sprint", trigger: "+ Sprint", cancel: "Cancelar" },
  { title: "Otro proyecto", trigger: "Crear o unirse a otro proyecto", cancel: "Cancelar" },
];
for (const dialog of dialogs) {
  for (const method of ["X", "Escape", "Cancelar", "fondo"]) {
    test(`${dialog.title}: salida por ${method}, animación completa y retorno del foco`, async ({ page, context }) => {
      await login(context);
      await board(page);
      const trigger = page.getByRole("button", { name: dialog.trigger, exact: true });
      await trigger.click();
      const panel = page.getByRole("dialog", { name: dialog.title, exact: true });
      await expect(panel).toBeVisible();
      await expect(page.locator("main")).toHaveAttribute("inert", "");
      const backdrop = page.locator(".modal-backdrop");
      await captureExit(backdrop);
      if (method === "X") await panel.getByRole("button", { name: "Cerrar ventana" }).click();
      if (method === "Escape") await page.keyboard.press("Escape");
      if (method === "Cancelar") await panel.getByRole("button", { name: dialog.cancel, exact: true }).click();
      if (method === "fondo") await backdrop.click({ position: { x: 3, y: 3 } });
      await expect(backdrop).toHaveAttribute("data-motion", "closing");
      await expect(panel).toHaveCount(1);
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
      await page.keyboard.press("Escape"); // Repeated closure cannot bypass the exit.
      await expect(panel).toHaveCount(1);
      await finishExit(backdrop);
      await expect(panel).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
      await trigger.click();
      await expect(panel).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
    });
  }
}

test("diálogo: foco inicial, Tab circular y arrastrar desde dentro no cierra", async ({ page, context }) => {
  await login(context); await board(page);
  await page.getByRole("button", { name: "+ Nueva tarea", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva tarea" });
  const title = dialog.getByLabel("Título", { exact: true });
  await expect(title).toBeFocused();
  const close = dialog.getByRole("button", { name: "Cerrar ventana" });
  await close.focus(); await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await page.locator("main h1").evaluate((element: HTMLElement) => element.focus());
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await page.mouse.move(3, 3); await page.mouse.up();
  await expect(page.locator(".modal-backdrop")).toHaveAttribute("data-motion", "open");
});

for (const kind of ["tarea", "sprint", "proyecto"]) {
  test(`guardar ${kind}: persiste una vez y sale con animación`, async ({ page, context, db }) => {
    await login(context); await board(page);
    const trigger = page.getByRole("button", { name: kind === "tarea" ? "+ Nueva tarea" : kind === "sprint" ? "+ Sprint" : "Crear o unirse a otro proyecto", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(kind === "tarea" ? "Título" : kind === "sprint" ? "Nombre" : "Nombre del proyecto", { exact: true }).fill(`Prueba movimiento ${kind}`);
    await captureExit(page.locator(".modal-backdrop"));
    await dialog.getByRole("button", { name: kind === "tarea" ? "Crear tarea" : kind === "sprint" ? "Crear sprint" : "Crear proyecto", exact: true }).last().click();
    await finishExit(page.locator(".modal-backdrop"));
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await db.collection(kind === "tarea" ? "tasks" : kind === "sprint" ? "sprints" : "workspaces").countDocuments({ [kind === "tarea" ? "title" : "name"]: `Prueba movimiento ${kind}` })).toBe(1);
  });
}

test("guardado pendiente bloquea duplicados; un fallo conserva formulario y anuncia el error", async ({ page, context }) => {
  await login(context); await board(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/mutate", async (route) => {
    requests++;
    await gate;
    await route.fulfill({ status: 503, json: { error: "No se pudo guardar la prueba. Inténtalo otra vez." } });
  });
  await page.getByRole("button", { name: "+ Nueva tarea", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva tarea" });
  await dialog.getByLabel("Título", { exact: true }).fill("No perder este borrador");
  await dialog.getByRole("button", { name: "Crear tarea", exact: true }).click();
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("button", { name: "Cerrar ventana" })).toBeDisabled();
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await dialog.locator("form").dispatchEvent("submit");
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-backdrop")).toHaveAttribute("data-motion", "open");
  release();
  await expect(dialog.getByRole("alert")).toContainText("No se pudo guardar");
  expect(requests).toBe(1);
  await expect(dialog.getByLabel("Título", { exact: true })).toHaveValue("No perder este borrador");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
});

test("Copiloto no bloquea el tablero y Escape solo cierra la capa superior", async ({ page, context }) => {
  await login(context); await board(page);
  const launcher = page.getByRole("button", { name: "Abrir copiloto de Sprintia" });
  await launcher.click();
  const assistant = page.locator(".assistant-panel");
  await expect(assistant.getByRole("button", { name: "Cerrar copiloto" })).toBeFocused();
  await expect(page.getByRole("main")).toBeVisible();
  await page.getByRole("button", { name: "+ Nueva tarea", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await expect(assistant).toBeVisible();
  await assistant.getByLabel("Mensaje para Sprintia Copiloto").fill("Borrador que se conserva");
  await captureExit(assistant);
  await page.keyboard.press("Escape");
  await finishExit(assistant);
  await expect(assistant).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(assistant.getByLabel("Mensaje para Sprintia Copiloto")).toHaveValue("Borrador que se conserva");
  await captureExit(assistant);
  await assistant.getByRole("button", { name: "Cerrar copiloto" }).click();
  await finishExit(assistant);
  await expect(assistant).toHaveCount(0);
});

test("menú móvil: salida completa y traspaso de foco al invitar", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(context); await board(page);
  const trigger = page.getByRole("button", { name: "Abrir menú", exact: true });
  await trigger.click();
  const sidebar = page.locator("#workspace-sidebar");
  await captureExit(sidebar);
  await sidebar.getByRole("button", { name: "+ Invitar al equipo", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await finishExit(sidebar);
  const dialog = page.getByRole("dialog", { name: "Invitar al equipo" });
  await expect(dialog.getByRole("button", { name: "Cerrar ventana" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("movimiento reducido: diálogos, Copiloto y menú sin animaciones ni espera artificial", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(context); await board(page);
  for (const item of dialogs) {
    const trigger = page.getByRole("button", { name: item.trigger, exact: true });
    await trigger.click();
    expect(await page.locator(".modal-backdrop").evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await page.getByRole("button", { name: "Abrir copiloto de Sprintia" }).click();
  expect(await page.locator(".assistant-panel").evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.keyboard.press("Escape"); await expect(page.locator(".assistant-panel")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  expect(await page.locator("#workspace-sidebar").evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Abrir menú", exact: true })).toBeFocused();
});

test("eliminar la tarjeta de origen devuelve el foco a un lugar visible", async ({ page, context, db }) => {
  await login(context); await board(page);
  await page.getByRole("article", { name: "UNI-01: Preparar entrevista Alfa" }).click();
  const dialog = page.getByRole("dialog", { name: "UNI-01" });
  await dialog.getByRole("button", { name: "Eliminar tarea" }).click();
  await captureExit(page.locator(".modal-backdrop"));
  await dialog.getByRole("button", { name: "Sí, eliminar" }).click();
  await finishExit(page.locator(".modal-backdrop"));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tablero", exact: true })).toBeFocused();
  expect(await db.collection("tasks").countDocuments({ workspaceId: ids.alpha, code: "UNI-01" })).toBe(0);
});

test("cambiar a movimiento reducido durante una salida termina sin dejar capas bloqueadas", async ({ page, context }) => {
  await login(context); await board(page);
  const trigger = page.getByRole("button", { name: "+ Nueva tarea", exact: true });
  await trigger.click();
  const backdrop = page.locator(".modal-backdrop");
  await captureExit(backdrop);
  await page.keyboard.press("Escape");
  await expect(backdrop).toHaveAttribute("data-exit-captured", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(backdrop).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("cada Añadir tarea restaura el foco a su propia columna", async ({ page, context }) => {
  await login(context); await board(page);
  const triggers = page.getByRole("button", { name: "+ Añadir tarea", exact: true });
  expect(await triggers.count()).toBe(4);
  for (let index = 0; index < 4; index++) {
    const trigger = triggers.nth(index);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Nueva tarea" });
    await expect(dialog.getByLabel("Título", { exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("editar una tarea conserva el origen al guardar y no pierde el contenido durante la salida", async ({ page, context, db }) => {
  await login(context); await board(page);
  const card = page.getByRole("article", { name: "UNI-01: Preparar entrevista Alfa" });
  await card.click();
  const dialog = page.getByRole("dialog", { name: "UNI-01" });
  const description = dialog.getByRole("textbox", { name: "Descripción", exact: true });
  await description.fill("Descripción editada con salida fluida.");
  await captureExit(page.locator(".modal-backdrop"));
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.locator(".modal-backdrop")).toHaveAttribute("data-motion", "closing");
  await expect(description).toHaveValue("Descripción editada con salida fluida.");
  await expect(dialog.getByLabel("Conflicto de tarea")).toHaveCount(0);
  await finishExit(page.locator(".modal-backdrop"));
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
  expect((await db.collection("tasks").findOne({ workspaceId: ids.alpha, code: "UNI-01" }))?.description).toBe("Descripción editada con salida fluida.");
});
