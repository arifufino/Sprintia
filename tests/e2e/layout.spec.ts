import type { Page } from "@playwright/test";
import type { Document } from "mongodb";
import { test, expect, login, ids } from "./fixtures";

async function openBoard(page: Page) {
  await page.goto("/");
  // Hide Next's development toggle, not any product controls.
  await page.addStyleTag({ path: "tests/e2e/screenshot.css" });
  await expect(page.getByRole("heading", { name: "Tablero", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preparar entrevista Alfa" })).toBeVisible();
}

async function noPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function minimumType(page: Page) {
  const violations = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((el) => {
    if (el.closest("[inert], [aria-hidden='true'], script, style, nextjs-portal, option, svg")) return false;
    const style = getComputedStyle(el);
    const hasText = Array.from(el.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    return hasText && el.getClientRects().length && style.visibility !== "hidden" && Number.parseFloat(style.fontSize) < 12;
  }).map((el) => `${el.tagName}.${el.className}: ${getComputedStyle(el).fontSize} ${el.textContent?.slice(0, 60)}`));
  expect(violations).toEqual([]);
}

for (const viewport of [{ width: 1440, height: 960 }, { width: 1107, height: 958 }, { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 640 }, { width: 640, height: 480 }]) {
  test(`distribución sin desbordamiento a ${viewport.width}×${viewport.height}`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await login(context);
    await openBoard(page);
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
    await noPageOverflow(page);
    await minimumType(page);
    await expect(page.getByRole("button", { name: "+ Sprint", exact: true })).toBeInViewport();
    const overview = await page.getByRole("region", { name: "Resumen del sprint" }).boundingBox();
    const filters = await page.getByRole("region", { name: "Filtros del tablero" }).boundingBox();
    expect(overview!.y + overview!.height).toBeLessThan(filters!.y);
    if (viewport.width > 900) {
      await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeInViewport();
      await expect(page.getByRole("button", { name: "Abrir menú", exact: true })).toBeHidden();
    } else {
      await expect(page.getByRole("button", { name: "Ocultar barra lateral" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Abrir menú", exact: true })).toBeInViewport();
    }
  });
}

test("lateral: arrastre real, límites, teclado, persistencia y colapso sin huecos", async ({ page, context }) => {
  await page.setViewportSize({ width: 1107, height: 958 });
  await login(context);
  await openBoard(page);
  const sidebar = page.getByRole("complementary", { name: "Barra lateral" });
  const resize = page.getByRole("separator", { name: "Ajustar ancho de la barra lateral" });
  await expect(resize).toHaveAttribute("aria-valuenow", "264");
  const initial = (await resize.boundingBox())!;
  await page.mouse.move(initial.x + initial.width / 2, 140);
  await page.mouse.down();
  await page.mouse.move(initial.x + initial.width / 2 + 80, 140, { steps: 8 });
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(344);
  expect((await page.getByRole("main").boundingBox())!.x).toBe(344);
  await noPageOverflow(page);
  await page.mouse.move(480, 140);
  await expect(resize).toHaveAttribute("aria-valuenow", "360");
  await page.mouse.up();
  await resize.focus();
  await resize.press("Home");
  await expect(resize).toHaveAttribute("aria-valuenow", "220");
  await resize.press("ArrowRight");
  await expect(resize).toHaveAttribute("aria-valuenow", "236");
  await page.reload();
  await expect(resize).toHaveAttribute("aria-valuenow", "236");
  await page.getByRole("button", { name: "Ocultar barra lateral" }).click();
  const reopen = page.getByRole("button", { name: "Mostrar barra lateral" });
  await expect(reopen).toBeFocused();
  await expect.poll(async () => (await page.getByRole("main").boundingBox())!.x).toBe(0);
  await expect(sidebar).toHaveCount(0); // inert content is absent from the accessibility tree.
  await noPageOverflow(page);
  const title = (await page.getByRole("heading", { name: "Tablero", exact: true }).boundingBox())!;
  const button = (await reopen.boundingBox())!;
  expect(button.x + button.width).toBeLessThan(title.x);
  await page.reload();
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByRole("button", { name: "Ocultar barra lateral" })).toBeFocused();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(236);
  await noPageOverflow(page);
});

test("menú móvil: oculto al entrar, foco contenido, Escape y fondo cierran", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.addInitScript(() => localStorage.setItem("sprintia-sidebar-collapsed", "true"));
  await login(context);
  await openBoard(page);
  const trigger = page.getByRole("button", { name: "Abrir menú", exact: true });
  await trigger.click();
  const close = page.getByRole("button", { name: "Cerrar menú", exact: true });
  await expect(close).toBeFocused();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeInViewport();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await close.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("main")).toBeVisible();
  await trigger.click();
  await page.getByRole("button", { name: "Cerrar menú lateral" }).click({ position: { x: 380, y: 100 } });
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("button", { name: "Equipo" }).click();
  await expect(page.getByRole("heading", { name: "Equipo", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar menú", exact: true })).toHaveCount(0);
  await noPageOverflow(page);
  await trigger.click();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await page.setViewportSize({ width: 390, height: 640 });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("entrada: texto legible y contraste del acceso en ambos temas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Continuar con Google" });
  await expect(button).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await noPageOverflow(page);
    await minimumType(page);
    await expect.poll(() => button.evaluate((el) => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map((value) => {
          const c = Number(value) / 255;
          return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
        });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      const style = getComputedStyle(el);
      const text = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
    })).toBeGreaterThanOrEqual(4.5);
  }
});

test("movimiento reducido conserva el colapso y el menú sin transiciones", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(context);
  await openBoard(page);
  await page.getByRole("button", { name: "Ocultar barra lateral" }).click();
  await expect(page.getByRole("button", { name: "Mostrar barra lateral" })).toBeFocused();
  await noPageOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cerrar menú", exact: true })).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Barra lateral" })).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Abrir menú", exact: true })).toBeFocused();
});

for (const theme of ["light", "dark"]) {
  test(`tipografía legible y vistas adaptables: ${theme}`, async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => localStorage.setItem("sprintia-theme", value), theme);
    await login(context);
    await openBoard(page);
    const navigation = page.getByRole("navigation", { name: "Navegación móvil" });
    let previousSize = 0;
    for (const size of ["small", "medium", "large", "xlarge"]) {
      // Exercise all existing views at every supported type size without zooming geometry.
      await page.evaluate((value) => { document.documentElement.dataset.textSize = value; }, size);
      const font = await page.locator("body").evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), zoom: getComputedStyle(el).zoom }));
      expect(font.size).toBeGreaterThan(previousSize);
      expect(Number(font.zoom)).toBe(1);
      previousSize = font.size;
      for (const name of ["Tablero", "Backlog", "Daily", "Resumen", "Equipo", "Ajustes"]) {
        await navigation.getByRole("button", { name, exact: true }).click();
        await noPageOverflow(page);
        await minimumType(page);
        const headingSize = await page.getByRole("heading", { level: 1 }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(headingSize).toBeGreaterThan(font.size);
      }
    }
  });
}

test("preferencias soportan almacenamiento bloqueado", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); };
  });
  await login(context);
  await openBoard(page);
  await page.getByRole("button", { name: "Ocultar barra lateral" }).click();
  await page.getByRole("button", { name: "Mostrar barra lateral" }).click();
  await noPageOverflow(page);
  expect(errors).toEqual([]);
});

test("todas las vistas se adaptan al ancho útil con lateral máximo y texto Muy grande", async ({ page, context }) => {
  await page.setViewportSize({ width: 1107, height: 720 });
  await page.addInitScript(() => { localStorage.setItem("sprintia-sidebar-width", "360"); if (!localStorage.getItem("sprintia-text-size")) localStorage.setItem("sprintia-text-size", "xlarge"); });
  await login(context);
  await openBoard(page);
  const navigation = page.getByRole("navigation", { name: "Navegación principal" });
  for (const name of [/^Backlog/, /^Daily$/, /^Resumen$/, /^Equipo$/, /^Configuración$/]) {
    await navigation.getByRole("button", { name }).click();
    await noPageOverflow(page);
    await minimumType(page);
  }
  await expect(page.getByRole("radio", { name: /Muy grande/ })).toBeChecked();
  await page.locator("label").filter({ has: page.getByRole("radio", { name: /Predeterminado y cómodo/ }) }).click();
  await expect(page.getByRole("radio", { name: /Predeterminado y cómodo/ })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
  await expect(page.getByRole("separator")).toHaveAttribute("aria-valuenow", "360");
});

test("nombres largos y ventana baja conservan el cierre de sesión y la distribución", async ({ page, context, db }) => {
  await db.collection<Document & { _id: string }>("workspaces").updateOne({ _id: ids.alpha }, { $set: { name: "Proyecto universitario de investigación interdisciplinaria con un nombre excepcionalmente largo" } });
  await db.collection<Document & { _id: string }>("sprints").updateOne({ _id: ids.sprintAlpha }, { $set: { goal: "Validar " + "objetivoextremadamentelargo".repeat(8) } });
  await page.setViewportSize({ width: 1107, height: 480 });
  await login(context);
  await openBoard(page);
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeInViewport();
  await noPageOverflow(page);
  await minimumType(page);
  await page.getByRole("separator").focus();
  await page.keyboard.press("End");
  await noPageOverflow(page);
  await page.getByRole("separator").press("Home");
  await noPageOverflow(page);
});
