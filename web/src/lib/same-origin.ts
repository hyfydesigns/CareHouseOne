import "server-only";

/** Route handlers don't get the server-action origin check, so JSON endpoints do it themselves. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const expected = process.env.APP_URL ? new URL(process.env.APP_URL).host : request.headers.get("host");
  try {
    return new URL(origin).host === expected;
  } catch {
    return false;
  }
}
