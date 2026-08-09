import type { Metadata } from "next";
import { chatGPTSignInPath, chatGPTSignOutPath } from "./chatgpt-auth";
import { getAppUser } from "./lib/auth";
import { SignInPage } from "./SignInPage";
import { SprintiaApp } from "./SprintiaApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sprintia — Scrum para equipos universitarios",
  description: "Organiza sprints, tareas y el progreso de tu equipo en un tablero Scrum simple y colaborativo.",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ join?: string }> }) {
  const params = await searchParams;
  const joinCode = typeof params.join === "string" ? params.join.slice(0, 20) : undefined;
  const user = await getAppUser();

  if (!user) {
    const returnTo = joinCode ? `/?join=${encodeURIComponent(joinCode)}` : "/";
    return <SignInPage signInPath={chatGPTSignInPath(returnTo)} />;
  }

  return (
    <SprintiaApp
      user={user}
      signOutPath={chatGPTSignOutPath("/")}
      initialJoinCode={joinCode}
    />
  );
}
