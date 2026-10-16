import { NextResponse, type NextRequest } from "next/server";

/** Pages that need a session cookie at all; requireUser() on the server does the real check. */
const SIGNED_IN = ["/dashboard", "/pin", "/locked", "/staff", "/audit", "/residents", "/meds", "/settings", "/vitals", "/notes", "/shift"];

/**
 * Content Security Policy with a fresh nonce per request: only the app's own scripts (which
 * Next.js tags with the nonce) can run, so injected markup can't execute. Inline style
 * attributes are allowed; they can't run code.
 */
function csp(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (SIGNED_IN.some((p) => path === p || path.startsWith(`${p}/`)) && !request.cookies.has("ch1_session")) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = csp(nonce);
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
