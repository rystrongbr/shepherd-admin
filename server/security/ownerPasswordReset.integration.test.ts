import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import bcrypt from "bcryptjs";

process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "owner-recovery-integration-test-only-secret";
process.env.OPENAI_API_KEY = "test-only-not-a-real-api-key";
process.env.ENABLE_REVIEWER_SIGNIN = "true";
process.env.REVIEWER_ENTERPRISE_PASSWORD_HASH = bcrypt.hashSync("paid-review-test-password", 12);
process.env.REVIEWER_FREE_PASSWORD_HASH = bcrypt.hashSync("free-review-test-password", 12);

test("real routes accept new owner password, reject old password/refresh, and preserve reviewer sessions and tiers", async () => {
  const { registerRoutes } = await import("../routes");
  const { createAdmin } = await import("../auth");
  const { storage, sqlite } = await import("../storage");
  const { applyOwnerPasswordReset } = await import("./ownerPasswordReset");
  const ownerEmail = "ryan@myshepherdapp.church";
  const oldPassword = "old-owner-integration-password";
  const newPassword = "new-owner-integration-password";
  createAdmin(ownerEmail, oldPassword, "owner");
  const accounts = [
    { email: "apple-review@myshepherdapp.church", password: "paid-review-test-password", tier: "enterprise" },
    { email: "apple-review+free@myshepherdapp.church", password: "free-review-test-password", tier: "free" },
  ];
  for (const account of accounts) storage.createUser({ email: account.email, tier: account.tier });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.url = req.url.replace(/^\/api\/v1(\/|$)/, "/api$1");
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const get = (path: string, token: string) => fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  try {
    const originalOwner = await post("/auth/login", { email: ownerEmail, password: oldPassword });
    assert.equal(originalOwner.status, 200);
    const originalOwnerSession = await originalOwner.json();
    const reviewerSessions: any[] = [];
    for (const account of accounts) {
      const response = await post("/v1/user/reviewer-signin", { email: account.email, password: account.password });
      assert.equal(response.status, 200);
      reviewerSessions.push(await response.json());
    }
    assert.equal(applyOwnerPasswordReset(sqlite, {
      OWNER_PASSWORD_RESET_ID: "integration-reset-20260928",
      OWNER_PASSWORD_RESET_PASSWORD: newPassword,
    }), "applied");
    assert.equal((await post("/auth/login", { email: ownerEmail, password: oldPassword })).status, 401);
    assert.equal((await post("/admin/refresh", { refreshToken: originalOwnerSession.refreshToken })).status, 401);
    const newLogin = await post("/auth/login", { email: ownerEmail, password: newPassword });
    assert.equal(newLogin.status, 200);
    const newOwner = await newLogin.json();
    assert.equal((await get("/waitlist/contacts", newOwner.accessToken)).status, 200);
    assert.equal((await post("/admin/refresh", { refreshToken: newOwner.refreshToken })).status, 200);
    for (let index = 0; index < accounts.length; index++) {
      const account = accounts[index];
      const previous = reviewerSessions[index];
      assert.equal((await get("/v1/user/me", previous.accessToken)).status, 200);
      assert.equal((await post("/v1/user/refresh", { refreshToken: previous.refreshToken })).status, 200);
      const login = await post("/v1/user/reviewer-signin", { email: account.email, password: account.password });
      assert.equal(login.status, 200);
      const current = await login.json();
      const entitlement = await get("/v1/iap/entitlement", current.accessToken);
      assert.equal(entitlement.status, 200);
      assert.equal((await entitlement.json()).tier, account.tier);
      assert.equal((await get("/waitlist/contacts", current.accessToken)).status, 401);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    sqlite.close();
  }
});
