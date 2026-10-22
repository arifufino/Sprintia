import { test, expect, ids, users, login, mutate, snapshot } from "./fixtures";

test.beforeEach(async ({ context }) => { await login(context); });

test("pedir un proyecto ajeno no filtra tareas, equipo, sprints ni invitación", async ({ context }) => {
  const response = await context.request.get(`/api/bootstrap?workspace=${ids.beta}`);
  // Explicit links must never silently fall back, nor disclose whether the project exists.
  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const data = await response.json();
  expect(data.error).toBe("El proyecto no existe o no tienes acceso.");
  const missing = await context.request.get("/api/bootstrap?workspace=ws_missing");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual(data);
  const serialized = JSON.stringify(data);
  for (const privateValue of [ids.beta, ids.sprintBeta, ids.taskBeta, users.outsider.id, users.outsider.email, "TESTBETA12345678", "Contenido confidencial Beta"]) {
    expect(serialized).not.toContain(privateValue);
  }
});

for (const action of ["createTask", "updateTask", "deleteTask", "createSprint"]) {
  test(`impide ${action} en un proyecto ajeno sin alterar la base`, async ({ context, db }) => {
    const before = await snapshot(db);
    const response = await mutate(context.request, {
      action, workspaceId: ids.beta, id: ids.taskBeta, sprintId: ids.sprintBeta,
      title: "Intrusión", name: "Sprint no autorizado", status: "done",
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("No tienes acceso");
    expect(await snapshot(db)).toEqual(before);
  });
}

for (const action of ["updateTask", "deleteTask"]) {
  test(`impide ${action} con una tarea ajena dentro de un workspace permitido`, async ({ context, db }) => {
    const before = await snapshot(db);
    const response = await mutate(context.request, { action, workspaceId: ids.alpha, id: ids.taskBeta, title: "Intrusión", status: "done" });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("No encontramos esa tarea");
    expect(await snapshot(db)).toEqual(before);
  });
}

for (const action of ["createTask", "updateTask"]) {
  for (const foreignField of ["sprintId", "assigneeId"] as const) {
    test(`impide ${action} con ${foreignField} de otro equipo`, async ({ context, db }) => {
      const before = await snapshot(db);
      const response = await mutate(context.request, {
        action, workspaceId: ids.alpha, id: ids.taskAlpha, title: "Referencia cruzada", status: "todo",
        sprintId: ids.sprintAlpha, assigneeId: users.owner.id,
        [foreignField]: foreignField === "sprintId" ? ids.sprintBeta : users.outsider.id,
      });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/no pertenece|debe pertenecer/);
      expect(await snapshot(db)).toEqual(before);
    });
  }
}

test("un miembro tampoco puede atribuirse el proyecto de otro equipo", async ({ context, db }) => {
  await login(context, users.member);
  const before = await snapshot(db);
  const response = await mutate(context.request, { action: "updateTask", workspaceId: ids.gamma, id: ids.taskGamma, status: "done" });
  expect(response.status()).toBe(400);
  expect(await snapshot(db)).toEqual(before);
});

test("rechaza una mutación autenticada enviada desde otro origen", async ({ context, db }) => {
  const before = await snapshot(db);
  const response = await context.request.post("/api/mutate", {
    data: { action: "deleteTask", workspaceId: ids.alpha, id: ids.taskAlpha },
    headers: { Origin: "https://outside.example.invalid" },
  });
  expect(response.status()).toBe(403);
  expect(await snapshot(db)).toEqual(before);
});
