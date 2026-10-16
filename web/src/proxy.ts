import { NextResponse, type NextRequest } from "next/server";

/**
 * A fast first gate: signed-in pages need a session cookie at all. The real check (valid,
 * not expired, two-step passed, account active) happens on the server in requireUser().
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("ch1_session")) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/staff/:path*", "/audit/:path*", "/residents/:path*", "/meds/:path*"],
};
