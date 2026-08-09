import { appDatabase, isMongoConfigured } from "../../../lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authConfigured = [
    process.env.AUTH_SECRET,
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
  ].every((value) => Boolean(value?.trim()));

  if (!authConfigured || !isMongoConfigured) {
    return Response.json(
      { ok: false, auth: authConfigured, database: isMongoConfigured },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const db = await appDatabase();
    await db.command({ ping: 1 });
    return Response.json(
      { ok: true, auth: true, database: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, auth: true, database: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
