import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { headers } from "next/headers";
import { resolveAppEnvironment } from "./lib/app-environment";
import "./globals.css";

const bodyFont = DM_Sans({ variable: "--font-body", subsets: ["latin"] });
const displayFont = Manrope({ variable: "--font-display", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const environment = resolveAppEnvironment(process.env.FCI_APP_ENVIRONMENT);
  const development = environment === "development";
  const title = development ? "FCI Operations | Development" : "Floor Coverings International | Commercial Operations";
  const description = development ? "Development workspace for the Floor Coverings International operations application." : "Lead-to-closeout commercial flooring operations for Floor Coverings International.";
  return {
    metadataBase: new URL(origin), title, description,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: "/fci-app-icon-master.png", type: "image/png", sizes: "1254x1254" }],
      shortcut: "/fci-app-icon-master.png",
      apple: [{ url: "/fci-app-icon-master.png", type: "image/png", sizes: "1254x1254" }],
    },
    applicationName: development ? "FCI Operations Dev" : "FCI Operations",
    appleWebApp: { capable: true, title: development ? "FCI Ops Dev" : "FCI Operations", statusBarStyle: "default" },
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>{children}</body>
    </html>
  );
}
