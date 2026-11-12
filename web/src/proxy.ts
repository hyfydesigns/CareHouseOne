import { NextResponse, type NextRequest } from "next/server";
import { appBaseUrl, isAdminHost, isSiteHost, SITE_PATHS, siteUrl } from "@/lib/hosts";

/** Pages that need a session cookie at all; requireUser() on the server does the real check. */
const SIGNED_IN = ["/dashboard", "/pin", "/locked", "/staff", "/timesheets", "/audit", "/residents", "/meds", "/settings", "/vitals", "/notes", "/shift", "/account", "/incidents", "/print", "/safety", "/adl", "/onboarding", "/reports"];

/**
 * Content Security Policy with a fresh nonce per request: only the app's own scripts (which
 * Next.js tags with the nonce) can run, so injected markup can't execute. Inline style
 * attributes are allowed; they can't run code.
 */
function csp(nonce: string, paypal: boolean): string {
  const dev = process.env.NODE_ENV === "development";
  // The public site's sign-up page loads PayPal's button, which runs in PayPal's own frames. Allowed
  // on every public page, not just /signup: clicking "Start free trial" changes page without loading
  // a new document, so the landing page's policy is the one in force. The app never allows PayPal.
  const pp = paypal ? " https://*.paypal.com https://*.paypalobjects.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${pp}`,
    "font-src 'self'",
    `connect-src 'self'${pp}`,
    ...(paypal ? [`frame-src${pp}`] : []),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** A redirect to the other hostname. Set by hand: NextResponse.redirect shortens it to a path when it thinks both hosts are the same origin. */
const elsewhere = (url: string) => new NextResponse(null, { status: 307, headers: { Location: url } });

/** Admin pages anyone can open: signing in and the one-time setup link. */
const ADMIN_PUBLIC = ["/admin/sign-in", "/admin/setup"];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const host = request.headers.get("host");
  const isAdminPath = path === "/admin" || path.startsWith("/admin/");
  // The admin site has its own address and only its own pages; they don't exist anywhere else.
  if (isAdminHost(host)) {
    // The public demo never has an admin site.
    if (process.env.DEMO_MODE === "true") return new NextResponse("Not found", { status: 404 });
    if (!isAdminPath) return NextResponse.redirect(new URL("/admin", request.url));
    if (!ADMIN_PUBLIC.some((p) => path === p || path.startsWith(`${p}/`)) && !request.cookies.has("ch1_admin")) {
      return NextResponse.redirect(new URL("/admin/sign-in", request.url));
    }
  } else if (isAdminPath) {
    return new NextResponse("Not found", { status: 404 });
  }
  const site = isSiteHost(host);
  // The public site only has its own pages; anything else belongs to the app, and vice versa.
  if (site && !SITE_PATHS.has(path)) return elsewhere(`${appBaseUrl()}${path}${request.nextUrl.search}`);
  if (!site && SITE_PATHS.has(path) && path !== "/") return elsewhere(`${siteUrl()}${path}${request.nextUrl.search}`);
  if (SIGNED_IN.some((p) => path === p || path.startsWith(`${p}/`)) && !request.cookies.has("ch1_session")) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = csp(nonce, site);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|icon-maskable.svg|sw.js|offline.html|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
