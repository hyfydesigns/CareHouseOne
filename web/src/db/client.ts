import path from "node:path";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const MIGRATIONS = path.join(process.cwd(), "drizzle");

async function openPglite(dataDir?: string): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir) (await import("node:fs")).mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as DB;
}

async function openPostgres(url: string): Promise<DB> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema }) as unknown as DB;
}

const g = globalThis as unknown as { __ch1Db?: Promise<DB> };

/**
 * The app database. With DATABASE_URL set it connects to PostgreSQL (Cloud SQL in production,
 * where migrations run as a separate deploy step). Without it, a local file-backed PGlite
 * database is used for development and migrated automatically.
 */
export function getDb(): Promise<DB> {
  if (!g.__ch1Db) {
    const url = process.env.DATABASE_URL;
    g.__ch1Db = url ? openPostgres(url) : openPglite(process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite"));
  }
  return g.__ch1Db;
}

/** A fresh in-memory database for tests. */
export function createTestDb(): Promise<DB> {
  return openPglite();
}

/**
 * Runs `fn` inside a transaction scoped to one organization. Row-level security policies
 * restrict every query to that organization's rows, so a bug in a query can't leak another
 * customer's data.
 */
export async function withTenant<T>(db: DB, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    await tx.execute(sql`set local role app_user`);
    return fn(tx);
  });
}
