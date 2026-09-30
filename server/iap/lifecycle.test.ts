import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { resolveAppleReceipt, type AppleResponse } from "./apple-verify";
import { effectiveTier } from "./effective-tier";
import { persistVerifiedSubscription, SubscriptionOwnershipError } from "./ownership";

const now = Date.parse("2026-09-30T22:00:00Z");
const monthly = "church.myshepherdapp.plus.monthly";
const yearly = "church.myshepherdapp.plus.yearly";
function entry(values: Record<string, any> = {}) {
  return {
    product_id: monthly, transaction_id: "transaction-1", original_transaction_id: "original-1",
    purchase_date_ms: now - 3600_000, expires_date_ms: now + 3600_000, ...values,
  };
}
function receipt(values: Partial<AppleResponse> = {}): AppleResponse {
  return {
    status: 0, environment: "Sandbox", receipt: { bundle_id: "church.myshepherdapp" },
    latest_receipt_info: [entry()], ...values,
  };
}
test("active and canceled-renewal receipts grant access until Apple's expiry, then Free at boundary", () => {
  const value = receipt({
    pending_renewal_info: [{ original_transaction_id: "original-1", product_id: monthly, auto_renew_status: "0" }],
  });
  assert.equal(resolveAppleReceipt(value, now).entitlementTier, "plus");
  const expired = resolveAppleReceipt(value, now + 3600_000);
  assert.equal(expired.entitlementTier, "free");
  assert.equal(expired.subscriptionStatus, "expired");
  assert.equal(expired.originalTransactionId, "original-1");
});
test("revoked receipt never grants access and upgraded history cannot hide a valid current purchase", () => {
  const revoked = entry({ cancellation_date_ms: now - 1000 });
  assert.equal(resolveAppleReceipt(receipt({ latest_receipt_info: [revoked] }), now).entitlementTier, "free");
  const selected = resolveAppleReceipt(receipt({ latest_receipt_info: [
    entry({ product_id: yearly, transaction_id: "old-annual", expires_date_ms: now + 20_000_000, is_upgraded: "true" }),
    entry({ product_id: "church.myshepherdapp.enterprise.monthly", transaction_id: "new-enterprise", purchase_date_ms: now - 1000 }),
  ] }), now);
  assert.equal(selected.entitlementTier, "enterprise");
  assert.equal(selected.transactionId, "new-enterprise");
  const overlap = resolveAppleReceipt(receipt({ latest_receipt_info: [
    { ...revoked, product_id: yearly, expires_date_ms: now + 20_000_000 },
    entry({ transaction_id: "valid-monthly" }),
  ] }), now);
  assert.equal(overlap.transactionId, "valid-monthly");
});
test("wrong bundle, invalid environment, malformed dates and missing original transaction fail closed", () => {
  for (const value of [
    receipt({ receipt: { bundle_id: "other.app" } }),
    receipt({ environment: undefined }),
    receipt({ latest_receipt_info: [entry({ expires_date_ms: "bad" })] }),
    receipt({ latest_receipt_info: [entry({ purchase_date_ms: now + 600_000 })] }),
    receipt({ latest_receipt_info: [entry({ original_transaction_id: undefined })] }),
    receipt({ latest_receipt_info: [entry({ product_id: "unrecognized" })] }),
  ]) assert.throws(() => resolveAppleReceipt(value, now));
});
test("Apple-provided grace grants temporary access; plain billing retry does not", () => {
  const expired = receipt({ latest_receipt_info: [entry({ expires_date_ms: now - 1 })] });
  assert.equal(resolveAppleReceipt(expired, now).entitlementTier, "free");
  expired.pending_renewal_info = [{
    original_transaction_id: "original-1", product_id: monthly,
    grace_period_expires_date_ms: now + 60_000,
  }];
  const grace = resolveAppleReceipt(expired, now);
  assert.equal(grace.subscriptionStatus, "grace");
  assert.equal(grace.accessExpiresDateMs, now + 60_000);
  assert.equal(resolveAppleReceipt(expired, now + 60_000).entitlementTier, "free");
  expired.latest_receipt_info![0].cancellation_date_ms = now - 1000;
  assert.equal(resolveAppleReceipt(expired, now).entitlementTier, "free");
});
test("effective authorization expires stale paid claims while preserving manually granted reviewer Enterprise", () => {
  assert.equal(effectiveTier({ tier: "plus", subscription_product_id: monthly, subscription_expires_at: new Date(now).toISOString() }, now), "free");
  assert.equal(effectiveTier({ tier: "plus", subscription_product_id: monthly, subscription_expires_at: null }, now), "free");
  assert.equal(effectiveTier({ tier: "enterprise", subscription_product_id: null, subscription_expires_at: null }, now), "enterprise");
});
function database() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE app_users (
    id INTEGER PRIMARY KEY, tier TEXT, subscription_product_id TEXT,
    subscription_original_txn_id TEXT, subscription_expires_at TEXT, subscription_updated_at TEXT
  );
  CREATE TABLE iap_transaction_owners (
    environment TEXT, original_transaction_id TEXT, user_id INTEGER,
    PRIMARY KEY(environment, original_transaction_id)
  );
  INSERT INTO app_users (id,tier) VALUES (1,'free'),(2,'free'),(3,'enterprise');`);
  return db;
}
test("one purchase cannot be silently transferred; ownership survives a later original transaction", () => {
  const db = database();
  try {
    const verified = resolveAppleReceipt(receipt(), now);
    assert.throws(() => persistVerifiedSubscription(db, 1, verified, true), SubscriptionOwnershipError);
    assert.equal(persistVerifiedSubscription(db, 1, verified, false).tier, "plus");
    assert.equal(persistVerifiedSubscription(db, 1, verified, true).tier, "plus");
    assert.throws(() => persistVerifiedSubscription(db, 2, verified, false), SubscriptionOwnershipError);
    const next = { ...verified, originalTransactionId: "original-2" };
    persistVerifiedSubscription(db, 1, next, false);
    assert.throws(() => persistVerifiedSubscription(db, 1, verified, true), SubscriptionOwnershipError);
    assert.throws(() => persistVerifiedSubscription(db, 2, verified, false), SubscriptionOwnershipError);
    assert.deepEqual(db.prepare("SELECT tier FROM app_users WHERE id=2").get(), { tier: "free" });
    assert.deepEqual(db.prepare("SELECT tier FROM app_users WHERE id=3").get(), { tier: "enterprise" });
  } finally { db.close(); }
});
test("legacy owner sync is accepted; ambiguous legacy ownership is rejected without changing accounts", () => {
  const db = database();
  try {
    const verified = resolveAppleReceipt(receipt(), now);
    db.prepare("UPDATE app_users SET subscription_original_txn_id=? WHERE id=1").run("original-1");
    persistVerifiedSubscription(db, 1, verified, true);
    db.prepare("UPDATE app_users SET subscription_original_txn_id=? WHERE id=2").run("original-1");
    const before = db.prepare("SELECT * FROM app_users").all();
    assert.throws(() => persistVerifiedSubscription(db, 1, verified, true), SubscriptionOwnershipError);
    assert.deepEqual(db.prepare("SELECT * FROM app_users").all(), before);
  } finally { db.close(); }
});
test("expired real transaction remains in history without restoring paid access", () => {
  const db = database();
  try {
    const verified = resolveAppleReceipt(receipt(), now + 3600_000);
    const result = persistVerifiedSubscription(db, 1, verified, false);
    assert.equal(result.tier, "free");
    assert.deepEqual(db.prepare("SELECT tier,subscription_original_txn_id FROM app_users WHERE id=1").get(),
      { tier: "free", subscription_original_txn_id: "original-1" });
  } finally { db.close(); }
});
