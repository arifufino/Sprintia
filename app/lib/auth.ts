import { getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import type { AppUser } from "./types";

const LOCAL_USER: ChatGPTUser = {
  userId: "local-demo-user",
  email: "estudiante@sprintia.local",
  displayName: "Alex Rivera",
  fullName: "Alex Rivera",
};

export async function getAppUser(): Promise<AppUser | null> {
  const user = await getChatGPTUser();
  const resolved = user ?? (process.env.NODE_ENV === "development" ? LOCAL_USER : null);

  if (!resolved) return null;

  return {
    id: resolved.userId,
    email: resolved.email,
    name: resolved.fullName ?? resolved.displayName ?? resolved.email,
  };
}
