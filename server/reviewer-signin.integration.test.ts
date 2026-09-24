import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Set before dynamic imports so this test can never touch an existing DB.
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "reviewer-integration-test-only-32-byte-secret";
// routes.ts imports the legacy AI client at module load. No AI endpoint or
// external service is called by this test; this is not a real credential.
process.env.OPENAI_API_KEY = "test-only-not-a-real-api-key";
process.env.ENABLE_REVIEWER_SIGNIN = "true";
process.env.REVIEWER_ENTERPRISE_PASSWORD_HASH = bcrypt.hashSync("test-paid-password-only", 12);
process.env.REVIEWER_FREE_PASSWORD_HASH = bcrypt.hashSync("test-free-password-only", 12);

test("production routing: reviewer tokens, tier access, refresh, and magic-link coexistence", async () => {
  const { registerRoutes } = await import("./routes");
  const { storage, sqlite } = await import("./storage");
  const paid = storage.createUser({
    email: "apple-review@myshepherdapp.church", name: "Review Enterprise", tier: "enterprise",
  });
  const free = storage.createUser({
    email: "apple-review+free@myshepherdapp.church", name: "Review Free", tier: "free",
  });
  const app = express();
  app.use(express.json());
  // Same URL rewrite as the production entry point.
  app.use((req, _res, next) => {
    req.url = req.url.replace(/^\/api\/v1(\/|$)/, "/api$1");
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  async function post(path: string, body: unknown) {
    return fetch(`${base}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  }
  async function get(path: string, token: string) {
    return fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  }
  try {
    for (const [user, password, tier] of [
      [paid, "test-paid-password-only", "enterprise"],
      [free, "test-free-password-only", "free"],
    ] as const) {
      const response = await post("/user/reviewer-signin", { email: user.email, password });
      assert.equal(response.status, 200);
      const session = await response.json();
      const claims = jwt.verify(session.accessToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
      assert.equal(claims.kind, "user");
      assert.equal(claims.tier, tier);
      assert.equal(claims.id, user.id);
      assert.equal((await get("/user/me", session.accessToken)).status, 200);
      const entitlement = await get("/iap/entitlement", session.accessToken);
      assert.equal(entitlement.status, 200);
      assert.equal((await entitlement.json()).tier, tier);
      // Consumer demo accounts must never gain admin privileges.
      assert.equal((await get("/demo/status", session.accessToken)).status, 401);
      const refreshed = await post("/user/refresh", { refreshToken: session.refreshToken });
      assert.equal(refreshed.status, 200);
      const next = await refreshed.json();
      assert.equal((await get("/user/me", next.accessToken)).status, 200);
      assert.equal((await post("/user/refresh", { refreshToken: session.refreshToken })).status, 401);
    }
    // A purchase/entitlement change must survive a new reviewer login.
    storage.updateUser(free.id, { tier: "plus" });
    const upgraded = await (await post("/user/reviewer-signin", {
      email: free.email, password: "test-free-password-only", tier: "enterprise",
    })).json();
    assert.equal((jwt.verify(upgraded.accessToken, process.env.JWT_SECRET!) as jwt.JwtPayload).tier, "plus");

    // Existing magic token verification is unchanged, including single-use.
    storage.setMagicToken("normal-customer@example.com", "test-magic-token", new Date(Date.now() + 60_000).toISOString());
    const magic = await fetch(`${base}/user/verify?token=test-magic-token`);
    assert.equal(magic.status, 200);
    assert.equal((await get("/user/me", (await magic.json()).accessToken)).status, 200);
    assert.equal((await fetch(`${base}/user/verify?token=test-magic-token`)).status, 401);
    // Unknown accounts cannot obtain a password session.
    assert.equal((await post("/user/reviewer-signin", {
      email: "normal-customer@example.com", password: "test-paid-password-only",
    })).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    sqlite.close();
  }
});
