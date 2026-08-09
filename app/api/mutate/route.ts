import { getAppUser } from "../../lib/auth";

export const dynamic = "force-dynamic";

type MutationBody = Record<string, unknown> & { action?: string };

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) {
    return Response.json({ error: "Inicia sesión para continuar." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as MutationBody;
    let workspaceId: string | undefined;
    const {
      createSprint,
      createTask,
      createWorkspace,
      deleteTask,
      joinWorkspace,
      updateTask,
    } = await import("../../../db/runtime");

    switch (body.action) {
      case "createTask":
        await createTask(user, body);
        break;
      case "updateTask":
        await updateTask(user, body);
        break;
      case "deleteTask":
        await deleteTask(user, body);
        break;
      case "createSprint":
        await createSprint(user, body);
        break;
      case "createWorkspace":
        workspaceId = await createWorkspace(user, body);
        break;
      case "joinWorkspace":
        workspaceId = await joinWorkspace(user, body);
        break;
      default:
        return Response.json({ error: "Acción no válida." }, { status: 400 });
    }

    return Response.json({ ok: true, workspaceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No pudimos guardar el cambio.";
    return Response.json({ error: message }, { status: 400 });
  }
}
