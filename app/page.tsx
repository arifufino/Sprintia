import type { Metadata } from "next";
import { signOutOfSprintia } from "./actions";
import { getAppUser } from "./lib/auth";
import { SignInPage } from "./SignInPage";
import { SprintiaApp } from "./SprintiaApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sprintia — Scrum para equipos universitarios",
  description: "Organiza sprints, tareas y el progreso de tu equipo en un tablero Scrum simple y colaborativo.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ join?: string; error?: string }>;
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
    return <SignInPage joinCode={joinCode} authError={authError} isConfigured={isConfigured} />;
  }

  return (
    <SprintiaApp
      user={user}
      signOutAction={signOutOfSprintia}
      initialJoinCode={joinCode}
    />
  );
}
