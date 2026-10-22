import { getAppUser } from "../../lib/auth";
import { getSprintReport } from "../../../db/reports";
import { WorkspaceUnavailableError } from "../../../db/runtime";
import { userFacingMessage, userFacingStatus } from "../../../lib/errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getAppUser(), headers = { "Cache-Control": "no-store" };
  if (!user) return Response.json({ error: "Inicia sesión para continuar." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  if (["workspace", "sprint", "before"].some((k) => params.getAll(k).length > 1) || ![params.get("workspace"), params.get("sprint")].every((v) => v && /^[a-zA-Z0-9_-]{1,128}$/.test(v)) || params.has("before") && (!/^[1-9]\d{0,14}$/.test(params.get("before")!) || !Number.isSafeInteger(Number(params.get("before"))))) return Response.json({ error: "El enlace del informe no es válido." }, { status: 400, headers });
  try { return Response.json(await getSprintReport(user, params.get("workspace")!, params.get("sprint")!, params.has("before") ? Number(params.get("before")) : null), { headers }); }
  catch (error) { return Response.json({ error: error instanceof WorkspaceUnavailableError ? "El sprint no existe o no tienes acceso." : userFacingMessage(error, "No pudimos calcular el informe.") }, { status: error instanceof WorkspaceUnavailableError ? 404 : userFacingStatus(error), headers }); }
}
