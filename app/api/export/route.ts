import { getAppUser } from "../../lib/auth";
import { exportProject } from "../../../db/project-export";
import { WorkspaceUnavailableError } from "../../../db/runtime";
import { userFacingMessage, userFacingStatus } from "../../../lib/errors";
import { logFailure } from "../../../lib/safe-log";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const user = await getAppUser();
  if (!user) return Response.json({ error: "Inicia sesión para continuar." }, { status: 401, headers });
  const params = new URL(request.url).searchParams, id = params.get("workspace");
  if (params.getAll("workspace").length !== 1 || !id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return Response.json({ error: "Selecciona un proyecto válido." }, { status: 400, headers });
  try {
    const data = await exportProject(user, id);
    return new Response(data, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="sprintia-${id}.json"` } });
  } catch (error) {
    const status = error instanceof WorkspaceUnavailableError ? 404 : userFacingStatus(error);
    if (status === 500) logFailure("export.failed", error);
    return Response.json({ error: status === 404 ? "El proyecto no existe o no tienes acceso." : userFacingMessage(error, "No pudimos exportar el proyecto. Inténtalo de nuevo.") }, { status, headers });
  }
}
