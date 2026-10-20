import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Cloud Scheduler's calls carry "Authorization: Bearer <CRON_SECRET>"; compared in constant time. */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}
