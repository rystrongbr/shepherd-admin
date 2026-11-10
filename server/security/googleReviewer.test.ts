import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { provisionGoogleReviewer, GOOGLE_REVIEWER_EMAIL } from "./googleReviewer";

// Syntactically valid cost-12 hash for provisioning tests; never a credential.
const env = {
  PROVISION_GOOGLE_REVIEWER: "true", ENABLE_REVIEWER_SIGNIN: "true",
  REVIEWER_GOOGLE_PASSWORD_HASH: "$2b$12$" + "a".repeat(53),
};
function fixture() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE app_users (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, tier TEXT, is_test_user INTEGER,
    subscription_product_id TEXT, subscription_original_txn_id TEXT, created_at TEXT, last_login_at TEXT)`);
  return db;
}
test("Google reviewer provisioning is opt-in and fails closed", () => {
  const db = fixture();
  try {
    assert.equal(provisionGoogleReviewer(db, {}), "disabled");
    assert.equal(provisionGoogleReviewer(db, { ...env, REVIEWER_GOOGLE_PASSWORD_HASH: "plaintext" }), "invalid-configuration");
    assert.equal(provisionGoogleReviewer(db, { ...env, ENABLE_REVIEWER_SIGNIN: "false" }), "invalid-configuration");
    assert.deepEqual(db.prepare("SELECT COUNT(*) AS n FROM app_users").get(), { n: 0 });
  } finally { db.close(); }
});
test("creates a Free test account with no purchase, and never touches an existing row", () => {
  const db = fixture();
  try {
    assert.equal(provisionGoogleReviewer(db, env), "created");
    const row = db.prepare("SELECT * FROM app_users WHERE email = ?").get(GOOGLE_REVIEWER_EMAIL) as Record<string, unknown>;
    assert.equal(row.tier, "free");
    assert.equal(row.is_test_user, 1);
    assert.equal(row.subscription_product_id, null);
    assert.equal(row.subscription_original_txn_id, null);
    db.prepare("UPDATE app_users SET tier = 'plus' WHERE email = ?").run(GOOGLE_REVIEWER_EMAIL);
    assert.equal(provisionGoogleReviewer(db, env), "preserved-existing");
    assert.equal((db.prepare("SELECT tier FROM app_users").get() as { tier: string }).tier, "plus");
  } finally { db.close(); }
});
