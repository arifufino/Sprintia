"use server";

import { signIn, signOut } from "../auth";
import { signInDestination } from "./lib/navigation";

export async function signInWithGoogle(destination = "/") {
  const redirectTo = signInDestination(destination);
  await signIn("google", { redirectTo });
}

export async function signOutOfSprintia() {
  await signOut({ redirectTo: "/" });
}
