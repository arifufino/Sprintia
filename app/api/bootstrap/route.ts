import { getAppUser } from "../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user) {
    return Response.json({ error: "Inicia sesión para continuar." }, { status: 401 });
  }

  try {
    const { getBootstrap } = await import("../../../db/runtime");
    const workspaceId = new URL(request.url).searchParams.get("workspace");
    const data = await getBootstrap(user, workspaceId);
    return Response.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No pudimos cargar el proyecto.";
    return Response.json({ error: message }, { status: 500 });
  }
}
