import type { Page } from "@playwright/test";
import { test, expect, login, ids, users, mutate } from "./fixtures";
import { defaultNavigation, navigationUrl, parseNavigation, signInDestination } from "../../app/lib/navigation";

const link = (extra: Record<string, string> = {}) => `/?${new URLSearchParams({ workspace: ids.alpha, view: "board", ...extra })}`;
const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });
const card = (page: Page) => page.getByRole("article", { name: "UNI-01: Preparar entrevista Alfa", exact: true });
const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Navegación principal" }).getByRole("button", { name: new RegExp(`^${name}`) });
async function open(page: Page, url = "/") {
  await page.goto(url);
  await page.addStyleTag({ path: "tests/e2e/screenshot.css" });
}

test.beforeEach(async ({ context }) => { await login(context); });

test("cada vista tiene URL, se recarga y recorre con Atrás/Adelante", async ({ page }) => {
  await open(page);
  for (const [view, label, title] of [["backlog", "Backlog", "Backlog"], ["daily", "Daily", "Daily"], ["summary", "Resumen", "Resumen"], ["team", "Equipo", "Equipo"], ["settings", "Configuración", "Configuración"]]) {
    await nav(page, label).click();
    await expect(heading(page, title)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`workspace=${ids.alpha}&view=${view}`));
    const url = page.url();
    await page.reload();
    await expect(heading(page, title)).toBeVisible();
    expect(page.url()).toBe(url);
  }
  await page.goBack(); await expect(heading(page, "Equipo")).toBeVisible();
  await page.goBack(); await expect(heading(page, "Resumen")).toBeVisible();
  await page.goForward(); await expect(heading(page, "Equipo")).toBeVisible();
});

test("proyectos conservan su URL y Atrás nunca mezcla los datos", async ({ page }) => {
  await open(page, link({ workspace: ids.gamma, view: "backlog" }));
  await expect(heading(page, "Backlog")).toBeVisible();
  await page.getByRole("combobox", { name: "Cambiar espacio de trabajo" }).selectOption(ids.alpha);
  await expect(page.getByText("Idea pendiente Alfa")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "Cambiar espacio de trabajo" })).toHaveValue(ids.gamma);
  await expect(page.getByText("Idea pendiente Alfa")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Cambiar espacio de trabajo" })).toHaveValue(ids.gamma);
});

test("sprint y filtros sobreviven a recarga y no añaden una entrada por letra", async ({ page, context }) => {
  const response = await mutate(context.request, { action: "createSprint", workspaceId: ids.alpha, name: "Sprint Dos", goal: "Navegación", startDate: "2026-10-16", endDate: "2026-10-30" });
  const { sprintId } = await response.json();
  expect(response.ok()).toBe(true);
  await open(page);
  await page.getByRole("combobox", { name: "Sprint", exact: true }).selectOption(sprintId);
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole("textbox", { name: "Buscar tareas" }).fill("diseño & QA");
  await page.getByRole("combobox", { name: "Filtrar por prioridad" }).selectOption("high");
  await page.getByRole("combobox", { name: "Filtrar por responsable" }).selectOption("none");
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  const url = page.url();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Sprint", exact: true })).toHaveValue(sprintId);
  await expect(page.getByRole("textbox", { name: "Buscar tareas" })).toHaveValue("diseño & QA");
  await expect(page.getByRole("combobox", { name: "Filtrar por prioridad" })).toHaveValue("high");
  await expect(page.getByRole("combobox", { name: "Filtrar por responsable" })).toHaveValue("none");
  expect(page.url()).toBe(url);
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "Sprint", exact: true })).toHaveValue(ids.sprintAlpha);
  await expect(page.getByRole("textbox", { name: "Buscar tareas" })).toHaveValue("");
  await page.goForward();
  await expect(page.getByRole("combobox", { name: "Sprint", exact: true })).toHaveValue(sprintId);
});

test("abrir tarea, Atrás y Adelante sincronizan diálogo, URL y foco", async ({ page }) => {
  await open(page);
  await card(page).click();
  await expect(page.getByRole("dialog", { name: "UNI-01" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`task=${ids.taskAlpha}`));
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card(page)).toBeFocused();
  expect(new URL(page.url()).searchParams.has("task")).toBe(false);
  await page.goForward();
  await expect(page.getByRole("dialog", { name: "UNI-01" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("task")).toBe(false);
  await page.goForward();
  await expect(page.getByRole("dialog", { name: "UNI-01" })).toBeVisible();
});

test("un enlace directo de tarea recarga, se comparte con otro miembro y cierra sin abandonar el proyecto", async ({ page, browser }) => {
  await open(page, link({ task: ids.taskAlpha }));
  await expect(page.getByRole("dialog", { name: "UNI-01" })).toBeVisible();
  const url = page.url();
  expect(url).not.toMatch(/join|invite|TESTALPHA/);
  await page.reload();
  await expect(page.getByRole("dialog").getByLabel("Título", { exact: true })).toHaveValue("Preparar entrevista Alfa");
  const member = await browser.newContext();
  try {
    await login(member, users.member);
    const memberPage = await member.newPage();
    await memberPage.goto(url);
    await expect(memberPage.getByRole("dialog").getByLabel("Título", { exact: true })).toHaveValue("Preparar entrevista Alfa");
    await memberPage.keyboard.press("Escape");
    await expect(memberPage.getByRole("dialog")).toHaveCount(0);
    await expect(heading(memberPage, "Tablero")).toBeVisible();
    expect(new URL(memberPage.url()).searchParams.get("workspace")).toBe(ids.alpha);
  } finally { await member.close(); }
});

test("enlace directo del backlog abre la tarea en su contexto", async ({ page }) => {
  await open(page, link({ task: "task_test_backlog" }));
  await expect(page.getByRole("dialog", { name: "UNI-02" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(heading(page, "Backlog")).toBeVisible();
});

for (const [query, title] of [
  [{ workspace: ids.beta }, "Proyecto no disponible"],
  [{ workspace: "ws_missing" }, "Proyecto no disponible"],
  [{ sprint: ids.sprintBeta }, "Sprint no disponible"],
  [{ sprint: "sp_deleted" }, "Sprint no disponible"],
  [{ task: ids.taskBeta }, "Tarea no disponible"],
  [{ task: "task_deleted" }, "Tarea no disponible"],
] as const) {
  test(`recurso inaccesible: ${JSON.stringify(query)}`, async ({ page }, testInfo) => {
    await open(page, link(query));
    await expect(heading(page, title)).toBeVisible();
    await expect(page.getByText("Contenido confidencial Beta")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Cambiar espacio de trabajo" })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if ("task" in query) {
      await page.screenshot({ path: testInfo.outputPath("unavailable-review.png"), animations: "disabled" });
      await page.getByRole("button", { name: "Volver al proyecto" }).click();
    } else await page.getByRole("button", { name: "Mis proyectos" }).click();
    await expect(heading(page, "Tablero")).toBeVisible();
    await expect(card(page)).toBeVisible();
  });
}

test("parámetros de recurso vacíos, duplicados o sin proyecto son errores, no otro tablero", async ({ page }) => {
  for (const url of ["/?workspace=", `/?workspace=${ids.alpha}&workspace=${ids.gamma}`, `/?task=${ids.taskAlpha}`, "/?workspace=%2Fprivate"]) {
    await open(page, url);
    await expect(heading(page, "Este enlace no es válido")).toBeVisible();
    await expect(heading(page, "Tablero")).toHaveCount(0);
  }
});

test("normaliza vista y filtros desconocidos sin interpretar contenido del enlace", async ({ page }) => {
  await open(page, link({ view: "<script>", priority: "critical", assignee: users.outsider.id, unknown: "drop", q: "<img onerror=alert(1)>" }));
  await expect(heading(page, "Tablero")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filtrar por prioridad" })).toHaveValue("all");
  await expect(page.getByRole("combobox", { name: "Filtrar por responsable" })).toHaveValue("all");
  await expect(page.getByRole("textbox", { name: "Buscar tareas" })).toHaveValue("<img onerror=alert(1)>");
  expect(new URL(page.url()).searchParams.has("unknown")).toBe(false);
});

test("permiso revocado durante un detalle retira todos sus datos en el refresco", async ({ page, db }) => {
  await page.clock.install();
  await open(page, link({ task: ids.taskAlpha }));
  await expect(page.getByRole("dialog")).toBeVisible();
  await db.collection("memberships").deleteOne({ workspaceId: ids.alpha, userId: users.owner.id });
  await page.clock.fastForward(26_000);
  await expect(heading(page, "Proyecto no disponible")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Preparar entrevista Alfa")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(ids.alpha);
});

test("sesión vencida conserva el enlace para iniciar sesión de nuevo", async ({ page, context }) => {
  await page.clock.install();
  await open(page, link({ view: "summary" }));
  await expect(heading(page, "Resumen")).toBeVisible();
  const url = page.url();
  await context.clearCookies();
  await page.clock.fastForward(26_000);
  await expect(heading(page, "Tu sesión ha terminado")).toBeVisible();
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeVisible();
  expect(page.url()).toBe(url);
  await login(context); await page.reload();
  await expect(heading(page, "Resumen")).toBeVisible();
});

test("respuesta tardía de un proyecto no reemplaza un Atrás más reciente", async ({ page }) => {
  await open(page);
  await expect(card(page)).toBeVisible();
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/bootstrap?workspace=${ids.gamma}`, async (route) => {
    const response = await route.fetch();
    entered(); await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByRole("combobox", { name: "Cambiar espacio de trabajo" }).selectOption(ids.gamma);
  await ready;
  await page.goBack();
  await expect(card(page)).toBeVisible();
  release();
  await expect(page.getByRole("combobox", { name: "Cambiar espacio de trabajo" })).toHaveValue(ids.alpha);
  await expect(page.getByText("Preparar informe Gamma")).toHaveCount(0);
});

test("fallo de red no cambia el enlace y reintentar recupera el mismo proyecto", async ({ page }) => {
  await page.route(`**/api/bootstrap?workspace=${ids.gamma}`, (route) => route.fulfill({ status: 503, json: { error: "Temporal" } }));
  await open(page, link({ workspace: ids.gamma }));
  await expect(heading(page, "No pudimos abrir tu espacio")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(ids.gamma);
  await page.unroute(`**/api/bootstrap?workspace=${ids.gamma}`);
  await page.getByRole("button", { name: "Intentar de nuevo" }).click();
  await expect(heading(page, "Preparar informe Gamma")).toBeVisible();
});

test("parser y retorno de OAuth solo permiten contexto local conocido", async () => {
  const url = navigationUrl({ ...defaultNavigation, workspace: ids.alpha, task: ids.taskAlpha, search: "á & ?", priority: "high" });
  expect(signInDestination(url + "&callbackUrl=https://outside.invalid&token=secret")).toBe(url);
  expect(parseNavigation(new URL(url, "https://local.invalid").searchParams).route.search).toBe("á & ?");
  for (const target of ["https://outside.invalid", "//outside.invalid", "/\\outside.invalid", "/api/auth/signout", "/?workspace=a\n"]) expect(signInDestination(target)).toBe("/");
  expect(signInDestination("/?join=testalpha1234567")).toBe("/?join=TESTALPHA1234567");
  expect(parseNavigation(new URLSearchParams("workspace=a&workspace=b")).problem).toBe("invalid");
});

test("Atrás durante un guardado espera su resultado sin saltar dos entradas ni reabrir la tarea", async ({ page, db }) => {
  await open(page);
  await nav(page, "Backlog").click();
  await nav(page, "Tablero").click();
  await card(page).click();
  const dialog = page.getByRole("dialog", { name: "UNI-01" });
  await dialog.getByLabel("Título", { exact: true }).fill("Título guardado antes de volver");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/mutate", async (route) => { await gate; await route.continue(); });
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await page.goBack();
  await expect(dialog).toHaveCount(1);
  release();
  await expect(dialog).toHaveCount(0);
  await expect(heading(page, "Tablero")).toBeVisible();
  expect(new URL(page.url()).searchParams.has("task")).toBe(false);
  await expect.poll(() => db.collection("tasks").countDocuments({ workspaceId: ids.alpha, title: "Título guardado antes de volver" })).toBe(1);
  await expect(heading(page, "Título guardado antes de volver")).toBeVisible();
  await page.goBack(); await expect(heading(page, "Backlog")).toBeVisible();
  await page.goForward(); await expect(heading(page, "Tablero")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("fallo del refresco conserva el borrador y el contexto del detalle", async ({ page }) => {
  await page.clock.install();
  await open(page, link({ task: ids.taskAlpha }));
  const dialog = page.getByRole("dialog", { name: "UNI-01" });
  const title = dialog.getByLabel("Título", { exact: true });
  await title.fill("Borrador sin guardar");
  const url = page.url();
  await page.route("**/api/bootstrap?**", (route) => route.fulfill({ status: 503, json: { error: "Temporal" } }));
  await page.clock.fastForward(26_000);
  await expect(dialog.getByRole("alert")).toContainText("Tu borrador se conserva");
  await expect(title).toHaveValue("Borrador sin guardar");
  expect(page.url()).toBe(url);
  await page.unroute("**/api/bootstrap?**");
  await page.clock.fastForward(26_000);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(title).toHaveValue("Borrador sin guardar");
});

test("copiar enlace de tarea no comparte invitaciones y se adapta a móvil", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, link({ task: ids.taskAlpha }));
  const dialog = page.getByRole("dialog", { name: "UNI-01" });
  await dialog.getByRole("button", { name: "Copiar enlace de tarea" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(page.url());
  expect(copied).not.toMatch(/join|invite|TESTALPHA/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("task-link-mobile-review.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Abrir menú", exact: true })).toBeFocused();
});

test("el enlace de invitación existente sigue uniéndose al proyecto correcto", async ({ page, db }) => {
  await open(page, "/?join=TESTBETA12345678");
  await expect(page.getByRole("combobox", { name: "Cambiar espacio de trabajo" })).toHaveValue(ids.beta);
  await expect(heading(page, "Contenido confidencial Beta")).toBeVisible();
  expect(new URL(page.url()).searchParams.has("join")).toBe(false);
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(ids.beta);
  expect(await db.collection("memberships").countDocuments({ workspaceId: ids.beta, userId: users.owner.id })).toBe(1);
  await page.reload();
  await expect(heading(page, "Contenido confidencial Beta")).toBeVisible();
});

test("historial rápido con movimiento reducido no deja diálogos ni fondo bloqueado", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await card(page).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => history.forward());
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("main")).not.toHaveAttribute("inert");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});
