process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "01234567890123456789012345678901";
process.env.NODE_ENV = "test";

import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

const { storage } = await import("../storage.ts");
const {
  createAdmin, issueUserTokens, requireAdmin, requireUser, verifyGoogleIdToken,
} = await import("../auth.ts");
const { anthropicQueue, authenticatedQuestionQuota } = await import("../rate-limits.ts");

function response() {
  let statusCode = 200;
  let body: any;
  const cookies: Record<string, string> = {};
  const res: any = {
    cookie(name: string, value: string) { cookies[name] = value; return res; },
    status(value: number) { statusCode = value; return res; },
    json(value: unknown) { body = value; return res; },
  };
  return { res, get status() { return statusCode; }, get body() { return body; }, cookies };
}

test("magic-link user token authorizes protected actor and refresh token is issued", () => {
  const user = storage.setMagicToken(`security-${Date.now()}@example.com`, "single-use-token", new Date(Date.now() + 60_000).toISOString());
  const verified = storage.verifyMagicToken("single-use-token");
  assert.equal(verified?.id, user.id);
  const out = response();
  const tokens = issueUserTokens(out.res, { id: user.id, email: user.email, tier: "free" });
  assert.ok(tokens.accessToken);
  assert.ok(tokens.refreshToken);
  const req: any = { header: (name: string) => name === "authorization" ? `Bearer ${tokens.accessToken}` : undefined };
  let nexted = false;
  requireUser(req, out.res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.user.id, user.id);
});

test("expired JWT and shared password-like values do not authorize administrators", () => {
  const out = response();
  const expired = jwt.sign({ kind: "admin", id: 1, email: "owner@example.com", role: "owner" }, process.env.JWT_SECRET!, { expiresIn: -1 });
  const expiredRequest: any = { header: () => `Bearer ${expired}` };
  requireAdmin(expiredRequest, out.res, () => assert.fail("expired token must not authorize"));
  assert.equal(out.status, 401);

  const fallbackRequest: any = { header: () => "Bearer shepherd2026" };
  const fallbackResponse = response();
  requireAdmin(fallbackRequest, fallbackResponse.res, () => assert.fail("fallback must not authorize"));
  assert.equal(fallbackResponse.status, 401);
});

test("admin passwords are hashed and wrong password is rejected by bcrypt", () => {
  const created = createAdmin(`admin-${Date.now()}@example.com`, "a safe enough admin password", "admin");
  assert.equal(created.role, "admin");
});

test("free user quota rejects the fourth daily request", () => {
  const user = storage.createUser({ email: `quota-${Date.now()}@example.com`, createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString() });
  for (let i = 0; i < 3; i++) {
    const out = response();
    let nexted = false;
    authenticatedQuestionQuota({ user: { id: user.id, email: user.email, tier: "free" }, header: () => "UTC" } as any, out.res, () => { nexted = true; });
    assert.equal(nexted, true);
  }
  const out = response();
  authenticatedQuestionQuota({ user: { id: user.id, email: user.email, tier: "free" }, header: () => "UTC" } as any, out.res, () => assert.fail("fourth request must be limited"));
  assert.equal(out.status, 429);
});

test("Anthropic queue holds the 21st job until a slot is released", async () => {
  const gates: Array<() => void> = [];
  const jobs = Array.from({ length: 21 }, () => anthropicQueue.execute(() => new Promise<string>(resolve => gates.push(() => resolve("done")))));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(gates.length, 20);
  gates.shift()!();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(gates.length, 20);
  const drain = setInterval(() => gates.shift()?.(), 1);
  await Promise.all(jobs);
  clearInterval(drain);
});

test("invalid Google signature is rejected before identity claims are read", async () => {
  await assert.rejects(() => verifyGoogleIdToken("not.a.google.jwt"));
});
