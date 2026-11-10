import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  createGooglePlayClient, googleAccountIdFor, resolveGoogleSubscription,
  GooglePlayVerificationError, type GoogleSubscriptionV2,
} from "./google-play";
import { buildAssetLinks } from "./assetlinks";

const now = Date.parse("2026-11-20T12:00:00Z");
const monthly = "church.myshepherdapp.plus.monthly";
function sub(values: Partial<GoogleSubscriptionV2> = {}): GoogleSubscriptionV2 {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    externalAccountIdentifiers: { obfuscatedExternalAccountId: "acct" },
    lineItems: [{ productId: monthly, expiryTime: new Date(now + 86_400_000).toISOString() }],
    ...values,
  };
}

test("active, grace and canceled-renewal grant access until expiry; then Free", () => {
  for (const state of ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"]) {
    const value = resolveGoogleSubscription("token-1", sub({ subscriptionState: state }), now);
    assert.equal(value.entitlementTier, "plus", state);
    assert.equal(resolveGoogleSubscription("token-1", sub({ subscriptionState: state }), now + 86_400_000).entitlementTier, "free");
  }
});

test("expired/revoked, on hold, paused and pending never grant access or need acknowledgement", () => {
  for (const state of ["SUBSCRIPTION_STATE_EXPIRED", "SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PAUSED",
    "SUBSCRIPTION_STATE_PENDING", "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED", "SOMETHING_NEW"]) {
    const value = resolveGoogleSubscription("token-1", sub({ subscriptionState: state }), now);
    assert.equal(value.entitlementTier, "free", state);
    assert.equal(value.needsAcknowledgement, false);
  }
});

test("unknown products are rejected; enterprise maps; test purchases use their own environment", () => {
  assert.throws(() => resolveGoogleSubscription("t", sub({ lineItems: [{ productId: "other", expiryTime: new Date(now + 1000).toISOString() }] }), now),
    GooglePlayVerificationError);
  const ent = resolveGoogleSubscription("t", sub({
    testPurchase: {},
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    lineItems: [{ productId: "church.myshepherdapp.enterprise.yearly", expiryTime: new Date(now + 1000).toISOString() }],
  }), now);
  assert.equal(ent.entitlementTier, "enterprise");
  assert.equal(ent.environment, "google-play-test");
  assert.equal(ent.needsAcknowledgement, false);
});

test("account id is stable per user, distinct between users, and fits Play's 64-char limit", () => {
  const secret = "s".repeat(40);
  assert.equal(googleAccountIdFor(1, secret), googleAccountIdFor(1, secret));
  assert.notEqual(googleAccountIdFor(1, secret), googleAccountIdFor(2, secret));
  assert.ok(googleAccountIdFor(1, secret).length <= 64);
  assert.throws(() => googleAccountIdFor(1, "short"));
});

test("client signs a service-account assertion, calls subscriptionsv2 and acknowledges", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const json = Buffer.from(JSON.stringify({ client_email: "svc@example.iam.gserviceaccount.com", private_key: key })).toString("base64");
  const calls: Array<{ url: string; method: string }> = [];
  const fakeFetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("/subscriptionsv2/tokens/missing")) return new Response("{}", { status: 410 });
    if (url.includes("/subscriptionsv2/")) return new Response(JSON.stringify(sub()), { status: 200 });
    return new Response("", { status: 200 });
  }) as typeof fetch;
  assert.equal(createGooglePlayClient({}, fakeFetch), null);
  const client = createGooglePlayClient({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: json }, fakeFetch)!;
  assert.equal(client.packageName, "church.myshepherdapp");
  assert.equal((await client.getSubscription("tok/1")).subscriptionState, "SUBSCRIPTION_STATE_ACTIVE");
  await client.acknowledge(monthly, "tok/1");
  await assert.rejects(client.getSubscription("missing"), (e: any) => e.status === 402 && !e.retryable);
  assert.equal(calls.filter(c => c.url.includes("oauth2")).length, 1, "token is cached");
  assert.ok(calls.some(c => c.url.endsWith(`/church.myshepherdapp/purchases/subscriptionsv2/tokens/tok%2F1`)));
  assert.ok(calls.some(c => c.method === "POST" && c.url.endsWith(`/subscriptions/${monthly}/tokens/tok%2F1:acknowledge`)));
});

test("assetlinks only serves well-formed fingerprints for the app package", () => {
  assert.equal(buildAssetLinks({}), null);
  assert.equal(buildAssetLinks({ GOOGLE_PLAY_SHA256_FINGERPRINTS: "nope" }), null);
  const fp = Array.from({ length: 32 }, () => "ab").join(":");
  const links = buildAssetLinks({ GOOGLE_PLAY_SHA256_FINGERPRINTS: ` ${fp} , bad` })!;
  assert.equal(links[0].target.package_name, "church.myshepherdapp");
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, [fp.toUpperCase()]);
  assert.deepEqual(links[0].relation, ["delegate_permission/common.handle_all_urls"]);
});
