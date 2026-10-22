import { getAppUser } from "../../lib/auth";
import { getDailyNote, WorkspaceUnavailableError } from "../../../db/runtime";
import { userFacingMessage, userFacingStatus } from "../../../lib/errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getAppUser();
  const headers = { "Cache-Control": "no-store" };
  if (!user) return Response.json({ error: "Inicia sesión para continuar." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  if (["workspace", "sprint", "date"].some((key) => params.getAll(key).length !== 1) || ![params.get("workspace"), params.get("sprint")].every((id) => id && /^[a-zA-Z0-9_-]{1,128}$/.test(id))) return Response.json({ error: "El enlace de notas no es válido." }, { status: 400, headers });
  try { return Response.json(await getDailyNote(user, params.get("workspace")!, params.get("sprint")!, params.get("date")), { headers }); }
  catch (error) { return Response.json({ error: error instanceof WorkspaceUnavailableError ? "El sprint no existe o no tienes acceso." : userFacingMessage(error, "No pudimos cargar las notas.") }, { status: error instanceof WorkspaceUnavailableError ? 404 : userFacingStatus(error), headers }); }
}
