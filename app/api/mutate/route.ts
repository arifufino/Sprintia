import { getAppUser } from "../../lib/auth";
import { userFacingMessage, userFacingStatus } from "../../../lib/errors";

export const dynamic = "force-dynamic";

type MutationBody = Record<string, unknown> & { action?: string };

const MAX_MUTATION_BYTES = 32_768;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return jsonResponse({ error: "Origen no permitido." }, 403);
      }
    } catch {
      return jsonResponse({ error: "Origen no válido." }, 403);
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return jsonResponse({ error: "Origen no permitido." }, 403);
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonResponse({ error: "El contenido debe enviarse como JSON." }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MUTATION_BYTES) {
    return jsonResponse({ error: "La solicitud es demasiado grande." }, 413);
  }

  const user = await getAppUser();
  if (!user) {
    return jsonResponse({ error: "Inicia sesión para continuar." }, 401);
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_MUTATION_BYTES) {
      return jsonResponse({ error: "La solicitud es demasiado grande." }, 413);
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      return jsonResponse({ error: "El JSON de la solicitud no es válido." }, 400);
    }
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return jsonResponse({ error: "La solicitud no es válida." }, 400);
    }
    const body = parsedBody as MutationBody;
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
        return jsonResponse({ error: "Acción no válida." }, 400);
    }

    return jsonResponse({ ok: true, workspaceId });
  } catch (error) {
    const status = userFacingStatus(error);
    if (status === 500) console.error("No pudimos guardar el cambio.", error);
    return jsonResponse(
      { error: userFacingMessage(error, "No pudimos guardar el cambio. Inténtalo de nuevo.") },
      status,
    );
  }
}
