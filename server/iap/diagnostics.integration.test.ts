import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";

process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "iap-diagnostic-isolated-test-secret-not-production";
process.env.APPLE_SHARED_SECRET = "PRIVATE_SHARED_SECRET";

test("diagnostics remain observational with validated tiers, ownership and fresh entitlement bodies", async () => {
  const { registerIapRoutes } = await import("./routes");
  const { verifyAppleReceipt } = await import("./apple-verify");
  const { requireUser } = await import("../auth");
  const { storage, sqlite } = await import("../storage");
  const target = storage.createUser({ email: "apple-review+free@myshepherdapp.church", tier: "free" });
  const other = storage.createUser({ email: "non-reviewer@example.com", tier: "free" });
  const app = express();
  app.use(express.json());
  registerIapRoutes(app);
  app.get("/protected-tier", requireUser, (req, res) => res.json({ tier: req.user!.tier }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalFlag = process.env.IAP_REVIEW_DIAGNOSTICS;
  const logs: string[] = [];
  const appleUrls: string[] = [];
  let expiry = Date.now() + 86_400_000;
  let appleStatus = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    assert.ok(url === "https://buy.itunes.apple.com/verifyReceipt" || url === "https://sandbox.itunes.apple.com/verifyReceipt");
    appleUrls.push(url);
    return new Response(JSON.stringify(url.includes("sandbox") ? {
      status: appleStatus, environment: "Sandbox",
      receipt: { bundle_id: "church.myshepherdapp" },
      latest_receipt: "PRIVATE_RAW_RECEIPT",
      latest_receipt_info: [{
        product_id: "church.myshepherdapp.plus.monthly",
        transaction_id: "PRIVATE_TRANSACTION", original_transaction_id: "PRIVATE_ORIGINAL",
        purchase_date_ms: String(Date.now() - 2 * 86_400_000), expires_date_ms: String(expiry),
      }],
      pending_renewal_info: [{ original_transaction_id: "PRIVATE_ORIGINAL", auto_renew_status: "1" }],
    } : { status: 21007 }), { status: 200 });
  };
  console.info = (...args) => {
    if (args[0] === "[iap-review-diagnostic]") logs.push(String(args[1]));
  };
  const call = (method: string, path: string, user = target, extraHeaders = {}) =>
    new Promise<{ status: number; headers: Record<string, any>; body: any }>((resolve, reject) => {
      const token = jwt.sign({ kind: "user", id: user.id, email: user.email, tier: "free" }, process.env.JWT_SECRET!);
      const req = request({
        hostname: "127.0.0.1", port, method, path,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extraHeaders },
      }, res => {
        let text = "";
        res.on("data", chunk => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: text ? JSON.parse(text) : null }));
      });
      req.on("error", reject);
      req.end(method === "POST" ? JSON.stringify({ receiptData: "PRIVATE_RAW_RECEIPT" }) : undefined);
    });
  try {
    delete process.env.IAP_REVIEW_DIAGNOSTICS;
    const off = await call("POST", "/api/iap/verify-receipt");
    assert.equal(off.status, 200);
    assert.equal(logs.length, 0);
    process.env.IAP_REVIEW_DIAGNOSTICS = "true";
    const on = await call("POST", "/api/iap/verify-receipt");
    assert.equal(on.status, off.status);
    for (const key of ["ok", "tier", "productId", "expiresAt", "environment", "tokenType", "expiresIn"]) {
      assert.deepEqual(on.body[key], off.body[key]);
    }
    assert.equal((jwt.decode(on.body.accessToken) as jwt.JwtPayload).tier, "plus");
    assert.deepEqual(appleUrls.slice(-2), ["https://buy.itunes.apple.com/verifyReceipt", "https://sandbox.itunes.apple.com/verifyReceipt"]);
    const entry = JSON.parse(logs.at(-1)!);
    assert.equal(entry.apple.autoRenewEnabled, true);
    assert.equal(entry.apple.expiresAt, new Date(expiry).toISOString());
    assert.equal(entry.apple.environment, "Sandbox");
    const get = await call("GET", "/api/iap/entitlement");
    assert.equal(get.status, 200);
    assert.equal(get.body.tier, "plus");
    assert.equal(get.headers["cache-control"], "private, no-store");
    const cached = await call("GET", "/api/iap/entitlement", target, { "If-None-Match": get.headers.etag });
    assert.equal(cached.status, 200);
    assert.equal(cached.body.tier, "plus");
    const cachedLog = JSON.parse(logs.at(-1)!);
    assert.equal(cachedLog.httpStatus, 200);
    assert.equal(cachedLog.ifNoneMatchPresent, true);
    assert.equal(cachedLog.decision.tier, "plus");
    assert.equal(cachedLog.storedOriginalTransactionFingerprint, entry.apple.originalTransactionFingerprint);
    delete process.env.IAP_REVIEW_DIAGNOSTICS;
    const cachedOff = await call("GET", "/api/iap/entitlement", target, { "If-None-Match": get.headers.etag });
    assert.equal(cachedOff.status, 200);
    assert.equal(cachedOff.headers.etag, cached.headers.etag);

    process.env.IAP_REVIEW_DIAGNOSTICS = "true";
    const count = logs.length;
    assert.equal((await call("POST", "/api/iap/verify-receipt", other)).status, 409);
    await call("GET", "/api/iap/entitlement", other);
    assert.equal(logs.length, count);
    expiry = Date.now() - 86_400_000;
    const expired = await call("POST", "/api/iap/verify-receipt");
    assert.equal(expired.body.tier, "free");
    assert.equal((jwt.decode(expired.body.accessToken) as jwt.JwtPayload).tier, "free");
    assert.equal(JSON.parse(logs.at(-1)!).apple.expiryInPast, true);
    const expiredGet = await call("GET", "/api/iap/entitlement");
    assert.equal(expiredGet.body.tier, "free");
    assert.equal(JSON.parse(logs.at(-1)!).decision.tier, "free");
    const staleToken = await call("GET", "/protected-tier", target, { Authorization: `Bearer ${on.body.accessToken}` });
    assert.equal(staleToken.body.tier, "free");
    // A later real renewal for the same original transaction restores access.
    expiry = Date.now() + 86_400_000;
    const renewed = await call("POST", "/api/iap/verify-receipt");
    assert.equal(renewed.body.tier, "plus");
    assert.equal((jwt.decode(renewed.body.accessToken) as jwt.JwtPayload).tier, "plus");
    appleStatus = 21002;
    assert.equal((await call("POST", "/api/iap/verify-receipt")).status, 402);
    assert.equal(JSON.parse(logs.at(-1)!).apple.appleStatus, 21002);
    appleStatus = 0;
    await assert.doesNotReject(verifyAppleReceipt("PRIVATE_RAW_RECEIPT", () => { throw new Error("observer failure"); }));
    assert.doesNotMatch(logs.join("\n"),
      /PRIVATE_RAW_RECEIPT|PRIVATE_SHARED_SECRET|PRIVATE_TRANSACTION|PRIVATE_ORIGINAL|accessToken|refreshToken|apple-review|non-reviewer/);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    if (originalFlag === undefined) delete process.env.IAP_REVIEW_DIAGNOSTICS;
    else process.env.IAP_REVIEW_DIAGNOSTICS = originalFlag;
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    sqlite.close();
  }
});
