"use server";

import { signIn, signOut } from "../auth";

function safeJoinCode(value?: string) {
  return typeof value === "string" && /^[A-Z0-9]{8,20}$/i.test(value) ? value.toUpperCase() : undefined;
}

export async function signInWithGoogle(joinCode?: string) {
  const cleanCode = safeJoinCode(joinCode);
  const redirectTo = cleanCode ? `/?join=${encodeURIComponent(cleanCode)}` : "/";
  await signIn("google", { redirectTo });
}

export async function signOutOfSprintia() {
  await signOut({ redirectTo: "/" });
}
