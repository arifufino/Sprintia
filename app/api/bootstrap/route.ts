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
    console.error("No pudimos cargar el proyecto.", error);
    return Response.json(
      { error: "No pudimos cargar el proyecto. Inténtalo de nuevo." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
