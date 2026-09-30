import type Database from "better-sqlite3";
import { validReviewerHash } from "../reviewer-signin";

export const EXPIRED_REVIEWER_EMAIL = "apple-review+expired@myshepherdapp.church";
type Result = "disabled" | "invalid-configuration" | "created" | "preserved-existing" | "failed";

/**
 * Explicit operator opt-in. Creates a DEMO expired entitlement, not an Apple
 * transaction. Never invents a receipt/transaction ID or resets any existing
 * account, including after a reviewer completes a real sandbox purchase.
 */
export function provisionExpiredReviewerDemo(
  sqlite: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Result {
  if (env.PROVISION_EXPIRED_REVIEWER_DEMO !== "true") return "disabled";
  if (env.ENABLE_REVIEWER_SIGNIN !== "true" ||
      !validReviewerHash(env.REVIEWER_EXPIRED_PASSWORD_HASH) ||
      !Number.isFinite(now.getTime())) return "invalid-configuration";
  try {
    return sqlite.transaction((): Result => {
      const existing = sqlite.prepare("SELECT id FROM app_users WHERE lower(email) = ?")
        .get(EXPIRED_REVIEWER_EMAIL);
      if (existing) return "preserved-existing";
      sqlite.prepare(`INSERT INTO app_users
        (email, name, tier, is_test_user, subscription_product_id,
         subscription_expires_at, subscription_original_txn_id, subscription_updated_at,
         created_at, last_login_at)
        VALUES (?, ?, 'free', 1, ?, ?, NULL, ?, ?, ?)`)
        .run(EXPIRED_REVIEWER_EMAIL, "App Review - Expired Entitlement Demo",
          "church.myshepherdapp.plus.monthly",
          new Date(now.getTime() - 86_400_000).toISOString(),
          now.toISOString(), now.toISOString(), now.toISOString());
      return "created";
    }).immediate();
  } catch {
    // Never log database rows, credentials, or exception payloads, and do not
    // take the production app offline if optional provisioning fails.
    return "failed";
  }
}
