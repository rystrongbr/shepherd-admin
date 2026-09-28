import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import { CONSENT_VERSION } from "./store";

process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "waitlist-integration-test-only-secret";
process.env.OPENAI_API_KEY = "test-only-never-used";
process.env.WAITLIST_ENABLED = "true";
process.env.WAITLIST_EMAIL_ENABLED = "false";

test("actual routing protects list from anonymous, consumer and non-owner admin; waitlist never creates app accounts", async () => {
  const { registerRoutes } = await import("../routes");
  const { sqlite, storage } = await import("../storage");
  const app = express();
  app.use((req, _res, next) => { req.url = req.url.replace(/^\/api\/v1(\/|$)/, "/api$1"); next(); });
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = (kind: string, role?: string) => jwt.sign(
    { kind, role, id: 999, email: "qa@example.com" }, process.env.JWT_SECRET!, { expiresIn: "5m" },
  );
  try {
    const response = await fetch(`${base}/api/waitlist`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "waitlist-only@example.com", consent: true, consentVersion: CONSENT_VERSION }),
    });
    assert.equal(response.status, 200);
    assert.equal(storage.getUserByEmail("waitlist-only@example.com"), undefined);
    for (const route of ["/api/waitlist/contacts", "/api/v1/waitlist/contacts", "/api/waitlist/export"]) {
      assert.equal((await fetch(base + route)).status, 401);
      assert.equal((await fetch(base + route, { headers: { Authorization: `Bearer ${token("user")}` } })).status, 401);
      assert.equal((await fetch(base + route, { headers: { Authorization: `Bearer ${token("admin", "admin")}` } })).status, 403);
      const owner = await fetch(base + route, { headers: { Authorization: `Bearer ${token("admin", "owner")}` } });
      assert.equal(owner.status, 200);
      assert.ok((await owner.text()).includes("waitlist-only@example.com"));
    }
    assert.equal((await fetch(`${base}/api/user/me`)).status, 401);
    assert.equal((await fetch(`${base}/api/iap/entitlement`)).status, 401);
    const page = await fetch(`${base}/waitlist`);
    assert.equal(page.status, 200);
    assert.ok(page.url.endsWith("/waitlist/"));
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    sqlite.close();
  }
});
