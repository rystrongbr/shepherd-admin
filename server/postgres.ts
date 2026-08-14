import PgPool from "pg-pool";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * Railway supplies DATABASE_URL.  The pool is intentionally capped at 20;
 * configure Railway's connection limit above the number of application replicas.
 */
export const pool = process.env.DATABASE_URL
  ? new PgPool({ connectionString: process.env.DATABASE_URL, max: 20, idleTimeoutMillis: 30_000 })
  : undefined;

export const postgresDb = pool ? drizzle({ client: pool }) : undefined;

export async function closePostgresPool() {
  await pool?.end();
}
