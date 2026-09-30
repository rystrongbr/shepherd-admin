import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { provisionExpiredReviewerDemo, EXPIRED_REVIEWER_EMAIL } from "./expiredReviewerDemo";

// Syntactically valid cost-12 hash for provisioning tests; never a credential.
const env = {
  PROVISION_EXPIRED_REVIEWER_DEMO: "true", ENABLE_REVIEWER_SIGNIN: "true",
  REVIEWER_EXPIRED_PASSWORD_HASH: "$2b$12$" + "a".repeat(53),
};
const now = new Date("2026-09-30T12:00:00Z");
function fixture() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE app_users (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, tier TEXT,
    is_test_user INTEGER, subscription_product_id TEXT, subscription_expires_at TEXT,
    subscription_original_txn_id TEXT, subscription_updated_at TEXT,
    created_at TEXT, last_login_at TEXT)`);
  return db;
}
test("expired fixture is explicit opt-in and fails closed without hash or auth", () => {
  const db = fixture();
  try {
    assert.equal(provisionExpiredReviewerDemo(db, {}), "disabled");
    assert.equal(provisionExpiredReviewerDemo(db, { ...env, REVIEWER_EXPIRED_PASSWORD_HASH: "plaintext" }), "invalid-configuration");
    assert.equal(provisionExpiredReviewerDemo(db, { ...env, ENABLE_REVIEWER_SIGNIN: "false" }), "invalid-configuration");
    assert.deepEqual(db.prepare("SELECT COUNT(*) AS n FROM app_users").get(), { n: 0 });
  } finally { db.close(); }
});
test("creates only a clearly identified free expired demo, without an Apple transaction", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO app_users (email, tier) VALUES (?, ?)").run("apple-review+free@myshepherdapp.church", "plus");
    assert.equal(provisionExpiredReviewerDemo(db, env, now), "created");
    const row = db.prepare("SELECT * FROM app_users WHERE email = ?").get(EXPIRED_REVIEWER_EMAIL) as Record<string, unknown>;
    assert.equal(row.tier, "free");
    assert.equal(row.is_test_user, 1);
    assert.equal(row.subscription_product_id, "church.myshepherdapp.plus.monthly");
    assert.equal(row.subscription_expires_at, "2026-09-29T12:00:00.000Z");
    assert.equal(row.subscription_original_txn_id, null);
    assert.match(String(row.name), /Demo/);
    assert.deepEqual(db.prepare("SELECT tier FROM app_users WHERE email = ?").get("apple-review+free@myshepherdapp.church"), { tier: "plus" });
  } finally { db.close(); }
});
test("restarts never reset a reviewer purchase or overwrite an existing identity", () => {
  const db = fixture();
  try {
    assert.equal(provisionExpiredReviewerDemo(db, env, now), "created");
    db.prepare("UPDATE app_users SET tier = 'plus', subscription_original_txn_id = 'test-real-purchase', subscription_expires_at = '2030-01-01'").run();
    const before = db.prepare("SELECT * FROM app_users").all();
    assert.equal(provisionExpiredReviewerDemo(db, env, now), "preserved-existing");
    assert.deepEqual(db.prepare("SELECT * FROM app_users").all(), before);
    assert.equal(provisionExpiredReviewerDemo(db, {}, now), "disabled");
  } finally { db.close(); }
});
test("missing schema does not crash startup", () => {
  const db = new Database(":memory:");
  try { assert.equal(provisionExpiredReviewerDemo(db, env, now), "failed"); }
  finally { db.close(); }
});
