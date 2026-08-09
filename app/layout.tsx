import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "sprintia.openai.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = new URL(`${protocol}://${host}`);
  const description = "Planifica sprints, comparte tareas y sigue el progreso de tu proyecto universitario.";

  return {
    metadataBase: origin,
    title: {
      default: "Sprintia — Scrum simple para tu equipo",
      template: "%s · Sprintia",
    },
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      locale: "es_EC",
      url: origin,
      siteName: "Sprintia",
      title: "Sprintia — Tu equipo, un sprint a la vez",
      description,
      images: [{ url: new URL("/og.png", origin).toString(), width: 1536, height: 1024, alt: "Sprintia, tablero Scrum colaborativo" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Sprintia — Tu equipo, un sprint a la vez",
      description,
      images: [new URL("/og.png", origin).toString()],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f6f8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
