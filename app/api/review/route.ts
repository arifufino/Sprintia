import { getAppUser } from "../../lib/auth";
import { getSprintReview } from "../../../db/review";
import { WorkspaceUnavailableError } from "../../../db/runtime";
import { userFacingMessage, userFacingStatus } from "../../../lib/errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getAppUser(), headers = { "Cache-Control": "no-store" };
  if (!user) return Response.json({ error: "Inicia sesión para continuar." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  if (["workspace", "sprint", "before", "entry"].some((key) => params.getAll(key).length > 1) || (params.has("before") && params.has("entry")) || ![params.get("workspace"), params.get("sprint"), ...["before", "entry"].filter((key) => params.has(key)).map((key) => params.get(key))].every((value) => value && /^[a-zA-Z0-9_-]{1,128}$/.test(value))) return Response.json({ error: "El enlace de Review no es válido." }, { status: 400, headers });
  try { return Response.json(await getSprintReview(user, params.get("workspace")!, params.get("sprint")!, params.get("before"), params.get("entry")), { headers }); }
  catch (error) { return Response.json({ error: error instanceof WorkspaceUnavailableError ? "El sprint no existe o no tienes acceso." : userFacingMessage(error, "No pudimos cargar la Review.") }, { status: error instanceof WorkspaceUnavailableError ? 404 : userFacingStatus(error), headers }); }
}
