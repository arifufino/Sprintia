import { getAppUser } from "../../lib/auth";
import { createHash } from "node:crypto";
import { getBootstrap, WorkspaceUnavailableError } from "../../../db/runtime";
import { logFailure } from "../../../lib/safe-log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user) {
    return Response.json({ error: "Inicia sesión para continuar." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const params = new URL(request.url).searchParams;
    const workspaceId = params.get("workspace");
    if (params.getAll("workspace").length > 1 || (workspaceId !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId))) throw new WorkspaceUnavailableError();
    const data = await getBootstrap(user, workspaceId);
    // Authorization and projection run BEFORE the conditional response, even for cached clients.
    const etag = `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
    if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
    return Response.json(data, {
      headers: { "Cache-Control": "no-store", ETag: etag },
    });
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) return Response.json(
      { error: "El proyecto no existe o no tienes acceso." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
    logFailure("bootstrap.failed", error);
    return Response.json(
      { error: "No pudimos cargar el proyecto. Inténtalo de nuevo." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
