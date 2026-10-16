/**
 * Runs once when a server instance starts, before it takes requests: checks production
 * configuration and applies database migrations.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkProductionConfig } = await import("./lib/config");
  checkProductionConfig();
  const url = process.env.DATABASE_URL;
  if (url && process.env.RUN_MIGRATIONS !== "false") {
    const { migrateDatabase } = await import("./db/client");
    await migrateDatabase(url);
    console.info("[startup] database migrations are up to date");
  }
}

/** Server errors go to Cloud Logging with the route and error only, never request bodies (they can hold resident details). */
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routerKind: string; routeType: string }) {
  const e = err as { message?: string; digest?: string };
  console.error(JSON.stringify({ severity: "ERROR", message: e.message ?? String(err), digest: e.digest, method: request.method, path: request.path.split("?")[0], route: context.routeType }));
}
