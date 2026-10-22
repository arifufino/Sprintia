import type { Metadata } from "next";
import { signOutOfSprintia } from "./actions";
import { getAppUser } from "./lib/auth";
import { SignInPage } from "./SignInPage";
import { SprintiaApp } from "./SprintiaApp";
import { signInDestination } from "./lib/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sprintia — Scrum para equipos universitarios",
  description: "Organiza sprints, tareas y el progreso de tu equipo en un tablero Scrum simple y colaborativo.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const joinCode = typeof params.join === "string" && /^[A-Z0-9]{8,20}$/i.test(params.join)
    ? params.join.toUpperCase()
    : undefined;
  const authError = typeof params.error === "string";
  const isConfigured = [
    process.env.AUTH_SECRET,
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
    process.env.MONGODB_URI,
  ].every((value) => Boolean(value?.trim()));
  const user = await getAppUser();

  if (!user) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
    }
    return <SignInPage returnTo={signInDestination(`/?${query}`)} authError={authError} isConfigured={isConfigured} />;
  }

  return (
    <SprintiaApp
      user={user}
      signOutAction={signOutOfSprintia}
      initialJoinCode={joinCode}
    />
  );
}
