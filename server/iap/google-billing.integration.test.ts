import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import Database from "better-sqlite3";
import { registerGoogleIapRoutes } from "./google-routes";
import { persistGoogleSubscription, GoogleAccountMismatchError } from "./google-ownership";
import { persistVerifiedSubscription, SubscriptionOwnershipError } from "./ownership";
import { resolveGoogleSubscription, GooglePlayVerificationError, type GoogleSubscriptionV2, type GooglePlayClient } from "./google-play";
import { resolveAppleReceipt } from "./apple-verify";

const now = Date.parse("2026-11-20T12:00:00Z");
const monthly = "church.myshepherdapp.plus.monthly";
const acct = (id: number) => `acct-${id}`;
function sub(values: Partial<GoogleSubscriptionV2> = {}, account = acct(1)): GoogleSubscriptionV2 {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    externalAccountIdentifiers: { obfuscatedExternalAccountId: account },
    lineItems: [{ productId: monthly, expiryTime: new Date(now + 86_400_000).toISOString() }],
    ...values,
  };
}
function database() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE app_users (
    id INTEGER PRIMARY KEY, email TEXT, tier TEXT, subscription_product_id TEXT,
    subscription_original_txn_id TEXT, subscription_expires_at TEXT, subscription_updated_at TEXT,
    subscription_platform TEXT);
  CREATE TABLE iap_transaction_owners (environment TEXT, original_transaction_id TEXT, user_id INTEGER,
    PRIMARY KEY(environment, original_transaction_id));
  INSERT INTO app_users (id,email,tier) VALUES (1,'one@example.com','free'),(2,'two@example.com','free');`);
  return db;
}
const row = (db: Database.Database, id: number) => db.prepare(
  "SELECT tier, subscription_product_id, subscription_original_txn_id, subscription_platform FROM app_users WHERE id=?",
).get(id);

test("Google purchase binds to the buying account; wrong account and transfers are rejected", () => {
  const db = database();
  try {
    const verified = resolveGoogleSubscription("token-0001", sub(), now);
    assert.throws(() => persistGoogleSubscription(db, 2, verified, acct(2), now), GoogleAccountMismatchError);
    assert.equal(persistGoogleSubscription(db, 1, verified, acct(1), now).tier, "plus");
    assert.deepEqual(row(db, 1), { tier: "plus", subscription_product_id: monthly,
      subscription_original_txn_id: "token-0001", subscription_platform: "google" });
    // Same token presented by another account that somehow carries a matching id.
    assert.throws(() => persistGoogleSubscription(db, 2, verified, acct(1), now), SubscriptionOwnershipError);
    // Missing account id: only the existing owner may refresh it.
    const anonymous = resolveGoogleSubscription("token-0001", sub({ externalAccountIdentifiers: {} }), now);
    assert.equal(persistGoogleSubscription(db, 1, anonymous, acct(1), now).tier, "plus");
    const fresh = resolveGoogleSubscription("token-new", sub({ externalAccountIdentifiers: {} }), now);
    assert.throws(() => persistGoogleSubscription(db, 1, fresh, acct(1), now), GoogleAccountMismatchError);
    assert.deepEqual(row(db, 2), { tier: "free", subscription_product_id: null,
      subscription_original_txn_id: null, subscription_platform: null });
  } finally { db.close(); }
});

test("upgrade token linked to another user's token is rejected; own linked token is accepted", () => {
  const db = database();
  try {
    persistGoogleSubscription(db, 1, resolveGoogleSubscription("old-1", sub(), now), acct(1), now);
    const stolen = resolveGoogleSubscription("new-2", sub({ linkedPurchaseToken: "old-1" }, acct(2)), now);
    assert.throws(() => persistGoogleSubscription(db, 2, stolen, acct(2), now), SubscriptionOwnershipError);
    const upgrade = resolveGoogleSubscription("new-1", sub({ linkedPurchaseToken: "old-1",
      lineItems: [{ productId: "church.myshepherdapp.enterprise.monthly", expiryTime: new Date(now + 86_400_000).toISOString() }] }), now);
    assert.equal(persistGoogleSubscription(db, 1, upgrade, acct(1), now).tier, "enterprise");
    // The replaced token later expires; it must not erase the new plan.
    const oldExpired = resolveGoogleSubscription("old-1", sub({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" }), now);
    assert.equal(persistGoogleSubscription(db, 1, oldExpired, acct(1), now).tier, "enterprise");
    assert.equal((row(db, 1) as any).subscription_original_txn_id, "new-1");
  } finally { db.close(); }
});

test("expired or refunded Google subscription drops to Free; an expired Apple receipt cannot erase active Google access", () => {
  const db = database();
  try {
    persistGoogleSubscription(db, 1, resolveGoogleSubscription("token-0001", sub({
      lineItems: [{ productId: monthly, expiryTime: new Date(Date.now() + 86_400_000).toISOString() }] }), Date.now()), acct(1));
    const expiredApple = resolveAppleReceipt({
      status: 0, environment: "Sandbox", receipt: { bundle_id: "church.myshepherdapp" },
      latest_receipt_info: [{ product_id: monthly, transaction_id: "a1", original_transaction_id: "apple-1",
        purchase_date_ms: Date.now() - 7200_000, expires_date_ms: Date.now() - 3600_000 }],
    });
    assert.equal(persistVerifiedSubscription(db, 1, expiredApple, false).tier, "plus");
    assert.equal((row(db, 1) as any).subscription_platform, "google");
    const revoked = resolveGoogleSubscription("token-0001", sub({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" }), now);
    assert.equal(persistGoogleSubscription(db, 1, revoked, acct(1), now).tier, "free");
    assert.equal((row(db, 1) as any).tier, "free");
  } finally { db.close(); }
});

async function fixture(subscriptions: Record<string, GoogleSubscriptionV2 | Error>, pushOk = true) {
  const db = database();
  const acknowledged: string[] = [];
  const client: GooglePlayClient = {
    packageName: "church.myshepherdapp",
    async getSubscription(token) {
      const value = subscriptions[token];
      if (!value) throw new GooglePlayVerificationError("Google Play did not recognize this purchase.", 402);
      if (value instanceof Error) throw value;
      return value;
    },
    async acknowledge(_productId, token) { acknowledged.push(token); },
  };
  const app = express();
  app.use(express.json());
  registerGoogleIapRoutes(app, {
    sqlite: db,
    requireUser: (req, _res, next) => {
      const id = Number(req.headers["x-test-user"] ?? 1);
      (req as any).user = { id, email: `${id}@example.com`, tier: "free" };
      next();
    },
    issueTokens: () => ({ accessToken: "test-access", refreshToken: "test-refresh" }),
    getClient: () => client,
    verifyPushToken: async token => pushOk && token === "valid-oidc",
    accountIdFor: acct,
    now: () => now,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/iap/google`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  const rtdn = (data: unknown, auth = "Bearer valid-oidc") => post("rtdn", {
    message: { data: Buffer.from(JSON.stringify(data)).toString("base64"), messageId: "1" }, subscription: "s",
  }, { Authorization: auth });
  return { db, acknowledged, post, rtdn, close: () => { server.close(); db.close(); } };
}

test("verify persists, acknowledges once, returns fresh tokens; wrong user and wrong product are refused", async () => {
  const f = await fixture({ "token-0001": sub(), "token-acked-1": sub({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" }) });
  try {
    let res = await f.post("verify", { purchaseToken: "token-0001", productId: "not.ours" });
    assert.equal(res.status, 400);
    res = await f.post("verify", { purchaseToken: "token-0001", productId: monthly }, { "x-test-user": "2" });
    assert.equal(res.status, 409);
    res = await f.post("verify", { purchaseToken: "token-0001", productId: monthly });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tier, "plus");
    assert.equal(body.accessToken, "test-access");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(f.acknowledged, ["token-0001"]);
    // Already acknowledged (e.g. by the app's finishTransaction): no second acknowledge.
    res = await f.post("verify", { purchaseToken: "token-acked-1", productId: monthly });
    assert.equal(res.status, 200);
    assert.deepEqual(f.acknowledged, ["token-0001"]);
    // Token Google does not recognize.
    res = await f.post("verify", { purchaseToken: "token-unknown-1", productId: monthly });
    assert.equal(res.status, 402);
  } finally { f.close(); }
});

test("RTDN requires Google's signed token, ignores unknown tokens, applies cancel/expiry, retries transient errors", async () => {
  const subs: Record<string, GoogleSubscriptionV2 | Error> = { "token-0001": sub() };
  const f = await fixture(subs);
  try {
    const note = (token: string, type = 3) => ({ packageName: "church.myshepherdapp",
      subscriptionNotification: { notificationType: type, purchaseToken: token, subscriptionId: monthly } });
    assert.equal((await f.rtdn(note("token-0001"), "Bearer forged")).status, 401);
    assert.equal((await f.rtdn(note("token-0001"), "")).status, 401);
    assert.equal((await f.rtdn(note("unknown"))).status, 204);
    assert.equal((await f.rtdn({ packageName: "church.myshepherdapp", testNotification: { version: "1.0" } })).status, 204);
    assert.equal((await f.rtdn({ ...note("token-0001"), packageName: "other.app" })).status, 204);
    assert.equal((await f.post("verify", { purchaseToken: "token-0001", productId: monthly })).status, 200);

    subs["token-0001"] = new GooglePlayVerificationError("Google Play is temporarily unavailable.", 502, true);
    assert.equal((await f.rtdn(note("token-0001"))).status, 500, "Pub/Sub retries");
    assert.equal((row(f.db, 1) as any).tier, "plus");

    subs["token-0001"] = sub({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" });
    assert.equal((await f.rtdn(note("token-0001", 13))).status, 204);
    assert.equal((row(f.db, 1) as any).tier, "free");
  } finally { f.close(); }
});
