import { lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { rateLimits } from "@/db/schema";
import { sha256 } from "@/lib/crypto";

/** Per-IP limits on the pages someone could hammer before signing in. */
export const LIMITS = {
  signIn: { limit: 20, windowSeconds: 15 * 60 },
  twoStep: { limit: 20, windowSeconds: 15 * 60 },
  reset: { limit: 5, windowSeconds: 15 * 60 },
  link: { limit: 30, windowSeconds: 15 * 60 },
} as const;

export type LimitName = keyof typeof LIMITS;

/**
 * Counts one attempt and says whether it's allowed. The IP is stored hashed. The window is fixed
 * (simple and good enough for brute-force protection; account lockout still applies on top).
 */
export async function hit(db: DB, name: LimitName, ip: string, now = new Date()): Promise<{ ok: true } | { ok: false; retryAfterMinutes: number }> {
  const { limit, windowSeconds } = LIMITS[name];
  const key = `${name}:${sha256(ip)}`;
  const cutoff = new Date(now.getTime() - windowSeconds * 1000);
  const fresh = sql`${rateLimits.windowStart} < ${cutoff.toISOString()}::timestamptz`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${fresh} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${fresh} then ${now.toISOString()}::timestamptz else ${rateLimits.windowStart} end`,
      },
    })
    .returning();
  if (row.count <= limit) return { ok: true };
  const resetAt = row.windowStart.getTime() + windowSeconds * 1000;
  return { ok: false, retryAfterMinutes: Math.max(1, Math.ceil((resetAt - now.getTime()) / 60_000)) };
}

export const tooMany = (r: { retryAfterMinutes: number }) => `Too many attempts from this network. Try again in ${r.retryAfterMinutes} minute${r.retryAfterMinutes === 1 ? "" : "s"}.`;

/** Housekeeping: counters older than a day are no longer needed. */
export async function pruneRateLimits(db: DB, now = new Date()): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 86_400_000)));
}
