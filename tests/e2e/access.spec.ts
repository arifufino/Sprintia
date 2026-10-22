import { test, expect, ids, users, login, setSession, mutate, snapshot } from "./fixtures";

test("sin sesión muestra Google y no permite leer ni escribir datos", async ({ page, request, db }) => {
  const before = await snapshot(db);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Tablero", exact: true })).toHaveCount(0);
  expect((await request.get(`/api/bootstrap?workspace=${ids.alpha}`)).status()).toBe(401);
  for (const action of ["createTask", "updateTask", "deleteTask", "reorderBacklog", "createSprint", "updateSprint", "startSprint", "closeSprint", "cancelSprint", "changeImpediment", "addTaskComment", "saveDailyNote", "saveSprintReview", "addReviewEntry", "convertReviewDecision", "addRetroObservation", "selectRetroProblem", "createRetroAction", "updateRetroAction", "createWorkspace", "joinWorkspace", "updateScrumConfiguration", "updateMemberAccess", "manageInvitation"]) {
    expect((await mutate(request, { action, workspaceId: ids.alpha, id: ids.taskAlpha, name: "No autorizado", title: "No autorizado" })).status()).toBe(401);
  }
  expect(await snapshot(db)).toEqual(before);
});

for (const kind of ["firma inválida", "sesión vencida", "sin correo", "sin identificador"] as const) {
  test(`rechaza una sesión con ${kind}`, async ({ context, db }) => {
    const before = await snapshot(db);
    const token: Record<string, string> = { sub: users.owner.id, userId: users.owner.id, email: users.owner.email, name: users.owner.name };
    if (kind === "sin correo") delete token.email;
    if (kind === "sin identificador") { delete token.sub; delete token.userId; }
    await setSession(context, token, undefined, kind === "sesión vencida" ? -3600 : 3600, kind === "firma inválida");
    expect((await context.request.get("/api/bootstrap")).status()).toBe(401);
    expect((await mutate(context.request, { action: "deleteTask", workspaceId: ids.alpha, id: ids.taskAlpha })).status()).toBe(401);
    expect(await snapshot(db)).toEqual(before);
  });
}

test("propietario y miembro reciben su proyecto compartido, no proyectos ajenos", async ({ browser }) => {
  for (const user of [users.owner, users.member]) {
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:4317" });
    try {
      await login(context, user);
      const response = await context.request.get(`/api/bootstrap?workspace=${ids.alpha}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      const data = await response.json();
      expect(data.user.id).toBe(user.id);
      expect(data.workspace.id).toBe(ids.alpha);
      expect(data.members.map((member: { id: string }) => member.id).sort()).toEqual([users.owner.id, users.member.id].sort());
      expect(data.tasks).toHaveLength(2);
      expect(data.tasks.every((task: { workspaceId: string }) => task.workspaceId === ids.alpha)).toBe(true);
      expect(JSON.stringify(data)).not.toContain("Beta");
      expect(JSON.stringify(data)).not.toContain(users.outsider.email);
    } finally { await context.close(); }
  }
});

test("cerrar sesión retira el acceso al tablero y a la API", async ({ page, context }) => {
  await login(context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tablero", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continuar con Google" })).toBeVisible();
  expect((await context.request.get("/api/bootstrap")).status()).toBe(401);
});
