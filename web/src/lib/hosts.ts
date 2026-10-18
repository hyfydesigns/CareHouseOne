/**
 * One service, two addresses: www.carehouseone.com is the public site (landing page, pricing,
 * sign-up) and app.carehouseone.com is the app. Locally, http://www.localhost:3000 is the site
 * and http://localhost:3000 (or app.localhost:3000, which the site links to, because Next.js
 * shortens redirects back to its own localhost into bare paths) is the app. Safe to use in the
 * proxy (no Node-only imports).
 */
const dev = process.env.NODE_ENV !== "production";

export const SITE_PATHS = new Set(["/", "/signup", "/privacy", "/terms", "/baa"]);

export function isSiteHost(host: string | null | undefined): boolean {
  const name = (host ?? "").split(":")[0].toLowerCase();
  const site = process.env.SITE_URL ? new URL(process.env.SITE_URL).hostname : null;
  return name === site || name.startsWith("www.");
}

export function siteUrl(): string {
  return (process.env.SITE_URL ?? (dev ? "http://www.localhost:3000" : "https://www.carehouseone.com")).replace(/\/$/, "");
}

export function appBaseUrl(): string {
  return (process.env.APP_URL ?? (dev ? "http://app.localhost:3000" : "https://app.carehouseone.com")).replace(/\/$/, "");
}
