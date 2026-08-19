import type { Metadata, Viewport } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "sprintia.vercel.app";
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

const preferenceBootScript = `
  (() => {
    const validThemes = ["light", "dark", "system"];
    const validTextSizes = ["small", "medium", "large", "xlarge"];
    // The product opens in the dark, editorial presentation used by Sprintia.
    // Users can still switch to light or system mode from Configuración.
    let theme = "dark";
    let textSize = "large";
    try {
      const savedTheme = localStorage.getItem("sprintia-theme");
      const savedTextSize = localStorage.getItem("sprintia-text-size");
      if (validThemes.includes(savedTheme)) theme = savedTheme;
      if (validTextSizes.includes(savedTextSize)) textSize = savedTextSize;
    } catch {}
    const resolvedTheme = theme === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = theme;
    root.dataset.textSize = textSize;
    root.style.colorScheme = resolvedTheme;
  })();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: preferenceBootScript }} /></head>
      <body className={`${dmSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
