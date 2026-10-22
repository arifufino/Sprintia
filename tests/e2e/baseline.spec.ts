import { test, expect, login } from "./fixtures";

// Names retain their origin. The phase-9 folder captures the neumorphic redesign;
// references from earlier phases remain unchanged in their original folders.
const views = [
  { name: "signin-desktop", width: 1440, height: 960, theme: "dark", signedIn: false },
  { name: "board-dark-desktop", width: 1440, height: 960, theme: "dark", signedIn: true },
  { name: "board-light-desktop", width: 1440, height: 960, theme: "light", signedIn: true },
  { name: "board-dark-1107", width: 1107, height: 958, theme: "dark", signedIn: true },
  { name: "board-dark-mobile", width: 390, height: 844, theme: "dark", signedIn: true },
  { name: "task-dialog-desktop", width: 1440, height: 960, theme: "dark", signedIn: true },
  { name: "copilot-desktop", width: 1440, height: 960, theme: "dark", signedIn: true },
  { name: "board-collapsed-1107", width: 1107, height: 958, theme: "dark", signedIn: true },
  { name: "board-resized-1107", width: 1107, height: 958, theme: "dark", signedIn: true },
  { name: "sidebar-mobile", width: 390, height: 640, theme: "dark", signedIn: true },
  { name: "summary-dark-1107", width: 1107, height: 958, theme: "dark", signedIn: true },
  { name: "backlog-dark-1107", width: 1107, height: 958, theme: "dark", signedIn: true },
  { name: "team-light-mobile", width: 390, height: 844, theme: "light", signedIn: true },
  { name: "settings-dark-mobile", width: 390, height: 844, theme: "dark", signedIn: true },
  { name: "board-low-desktop", width: 1280, height: 720, theme: "dark", signedIn: true },
];

for (const view of views) {
  test(`referencia visual: ${view.name}`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.clock.setFixedTime(new Date("2026-10-12T15:00:00.000Z"));
    await page.addInitScript((theme) => {
      localStorage.setItem("sprintia-theme", theme);
      localStorage.setItem("sprintia-text-size", "large");
    }, view.theme);
    if (view.signedIn) await login(context);
    await page.goto("/");
    if (view.signedIn) {
      await expect(page.getByRole("heading", { name: "Tablero", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Preparar entrevista Alfa" })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeVisible();
    }
    if (view.name === "task-dialog-desktop") {
      await page.getByRole("button", { name: "+ Nueva tarea", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Nueva tarea" })).toBeVisible();
    }
    if (view.name === "copilot-desktop") {
      await page.getByRole("button", { name: /Abrir copiloto/i }).click();
      await expect(page.locator(".assistant-panel").getByRole("button", { name: "Cerrar copiloto" })).toBeVisible();
    }
    if (view.name === "board-collapsed-1107") {
      await page.getByRole("button", { name: "Ocultar barra lateral" }).click();
      await expect(page.getByRole("button", { name: "Mostrar barra lateral" })).toBeFocused();
    }
    if (view.name === "board-resized-1107") {
      await page.getByRole("separator").press("End");
      await expect(page.getByRole("separator")).toHaveAttribute("aria-valuenow", "360");
    }
    if (view.name === "sidebar-mobile") {
      await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
      await expect(page.getByRole("button", { name: "Cerrar menú", exact: true })).toBeFocused();
    }
    const target = view.name.startsWith("summary-") ? "Resumen" : view.name.startsWith("backlog-") ? "Backlog" : view.name.startsWith("team-") ? "Equipo" : view.name.startsWith("settings-") ? "Ajustes" : null;
    if (target) {
      await page.addStyleTag({ path: "tests/e2e/screenshot.css" });
      const nav = page.getByRole("navigation", { name: view.width <= 900 ? "Navegación móvil" : "Navegación principal" });
      await nav.getByRole("button", { name: new RegExp(`^${target}`) }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(target === "Ajustes" ? "Configuración" : target);
    }
    await page.evaluate(() => document.fonts.ready);
    // Keep existing filenames inside the separately versioned phase-9 folder.
    const phase7 = ["task-dialog-desktop", "backlog-dark-1107"].includes(view.name);
    await expect(page).toHaveScreenshot(`${phase7 ? "phase-7-" : view.signedIn ? "phase-6-" : ""}${view.name}.png`, {
      animations: "disabled",
      caret: "hide",
      // Only hide Next's development tooling, never product elements.
      stylePath: "tests/e2e/screenshot.css",
    });
    if (["task-dialog-desktop", "copilot-desktop", "sidebar-mobile"].includes(view.name)) {
      await page.addStyleTag({ path: "tests/e2e/screenshot.css" });
      await page.screenshot({ path: testInfo.outputPath("review.png"), animations: "disabled", caret: "hide" });
    }
  });
}
