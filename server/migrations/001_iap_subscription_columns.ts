/**
 * Migration 001 — StoreKit subscription columns on app_users.
 *
 * Usage (Railway one-off or local):
 *   DATABASE_URL=... npx tsx server/migrations/001_iap_subscription_columns.ts
 *
 * Adds four nullable columns backing the /api/v1/iap/verify-receipt flow.
 * All columns are nullable because every existing row is a free-tier user
 * without a subscription — we don't want to make up transaction ids.
 *
 * Idempotent: each ALTER uses IF NOT EXISTS. Safe to run repeatedly.
 */

import PgPool from "pg-pool";

const DATABASE_URL = process.env.DATABASE_URL;

const statements = [
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS subscription_product_id text`,
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS subscription_original_txn_id text`,
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS subscription_expires_at text`,
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS subscription_updated_at text`,
  // Fast lookup for renewal-notification webhooks (v1.1): find the user
  // whose original_transaction_id matches Apple's ServerToServer payload.
  `CREATE INDEX IF NOT EXISTS idx_app_users_subscription_original_txn ON app_users(subscription_original_txn_id) WHERE subscription_original_txn_id IS NOT NULL`,
  // Fast lookup for the nightly expiration sweep — find every user whose
  // subscription is currently active but past its expires_at.
  `CREATE INDEX IF NOT EXISTS idx_app_users_subscription_expires ON app_users(subscription_expires_at) WHERE subscription_expires_at IS NOT NULL`,
];

async function main() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new PgPool({ connectionString: DATABASE_URL, max: 5 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const stmt of statements) {
      console.log("[iap-migration] running:", stmt.slice(0, 80) + (stmt.length > 80 ? "..." : ""));
      await client.query(stmt);
    }
    await client.query("COMMIT");
    console.log("[iap-migration] complete");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("[iap-migration] failed:", err);
  process.exit(1);
});
