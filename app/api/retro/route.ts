import { getAppUser } from "../../lib/auth";
import { getRetroAction, getSprintRetro } from "../../../db/retro";
import { WorkspaceUnavailableError } from "../../../db/runtime";
import { userFacingMessage, userFacingStatus } from "../../../lib/errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getAppUser(), headers = { "Cache-Control": "no-store" };
  if (!user) return Response.json({ error: "Inicia sesión para continuar." }, { status: 401, headers });
  const params = new URL(request.url).searchParams, keys = ["workspace", "sprint", "action", "before", "filter"];
  const filter = params.get("filter") ?? "open";
  if (keys.some((key) => params.getAll(key).length > 1) || (params.has("action") && params.has("filter")) || !["open", "origin", "all"].includes(filter) || ![params.get("workspace"), params.get("sprint"), ...["action", "before"].filter((key) => params.has(key)).map((key) => params.get(key))].every((v) => v && /^[a-zA-Z0-9_-]{1,128}$/.test(v))) return Response.json({ error: "El enlace de retrospectiva no es válido." }, { status: 400, headers });
  try { return Response.json(params.has("action") ? await getRetroAction(user, params.get("workspace")!, params.get("sprint")!, params.get("action")!, params.get("before")) : await getSprintRetro(user, params.get("workspace")!, params.get("sprint")!, filter as "open" | "origin" | "all", params.get("before")), { headers }); }
  catch (error) { return Response.json({ error: error instanceof WorkspaceUnavailableError ? "El recurso no existe o no tienes acceso." : userFacingMessage(error, "No pudimos cargar la retrospectiva.") }, { status: error instanceof WorkspaceUnavailableError ? 404 : userFacingStatus(error), headers }); }
}
