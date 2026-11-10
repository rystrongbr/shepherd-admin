import type Database from "better-sqlite3";
import { validReviewerHash } from "../reviewer-signin";

export const GOOGLE_REVIEWER_EMAIL = "google-review@myshepherdapp.church";
type Result = "disabled" | "invalid-configuration" | "created" | "preserved-existing" | "failed";

/**
 * Explicit operator opt-in (PROVISION_GOOGLE_REVIEWER=true). Creates the
 * Google Play reviewer as an ordinary Free account so Google can sign in with
 * a password and test the real Play Billing purchase flow. Never grants a
 * paid tier, never invents a purchase, and never modifies an existing row.
 */
export function provisionGoogleReviewer(
  sqlite: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Result {
  if (env.PROVISION_GOOGLE_REVIEWER !== "true") return "disabled";
  if (env.ENABLE_REVIEWER_SIGNIN !== "true" ||
      !validReviewerHash(env.REVIEWER_GOOGLE_PASSWORD_HASH) ||
      !Number.isFinite(now.getTime())) return "invalid-configuration";
  try {
    return sqlite.transaction((): Result => {
      const existing = sqlite.prepare("SELECT id FROM app_users WHERE lower(email) = ?")
        .get(GOOGLE_REVIEWER_EMAIL);
      if (existing) return "preserved-existing";
      sqlite.prepare(`INSERT INTO app_users (email, name, tier, is_test_user, created_at, last_login_at)
        VALUES (?, ?, 'free', 1, ?, ?)`)
        .run(GOOGLE_REVIEWER_EMAIL, "Google Play Review", now.toISOString(), now.toISOString());
      return "created";
    }).immediate();
  } catch {
    // Never log rows or credentials; never block boot on optional setup.
    return "failed";
  }
}
