import { auth } from "../../auth";
import type { AppUser } from "./types";

export async function getAppUser(): Promise<AppUser | null> {
  const session = await auth();
  const sessionUser = session?.user as
    | { id?: string; email?: string | null; name?: string | null }
    | undefined;
  if (!sessionUser?.id || !sessionUser.email) return null;

  return {
    id: sessionUser.id,
    email: sessionUser.email,
    name: sessionUser.name?.trim() || sessionUser.email,
  };
}
