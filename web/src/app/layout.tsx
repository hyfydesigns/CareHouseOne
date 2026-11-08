import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import "./globals.css";

// The fonts ship with the app (SIL Open Font License, see ./fonts) so the build never has to
// reach Google Fonts; a failed download there used to fail the deploy.
const display = localFont({
  src: [
    { path: "./fonts/lexend-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/lexend-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/lexend-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});
const body = localFont({
  src: [
    { path: "./fonts/atkinson-hyperlegible-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/atkinson-hyperlegible-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CareHouse One",
  description: "Group home care management",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Every page renders per request so Next.js can tag its scripts with the CSP nonce (src/proxy.ts).
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
