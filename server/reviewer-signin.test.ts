import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import bcrypt from "bcryptjs";
import { registerReviewerSignin } from "./reviewer-signin";
import { readFileSync } from "node:fs";

const paidEmail = "apple-review@myshepherdapp.church";
const freeEmail = "apple-review+free@myshepherdapp.church";
// Test-only credentials, never production configuration.
const paidPassword = "test-only-enterprise-password";
const freePassword = "test-only-free-password";
const env = {
  ENABLE_REVIEWER_SIGNIN: "true",
  REVIEWER_ENTERPRISE_PASSWORD_HASH: bcrypt.hashSync(paidPassword, 12),
  REVIEWER_FREE_PASSWORD_HASH: bcrypt.hashSync(freePassword, 12),
};

async function fixture(overrides: NodeJS.ProcessEnv = {}, missing = false, failTokens = false) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.url = req.url.replace(/^\/api\/v1\//, "/api/");
    next();
  });
  const issued: unknown[] = [];
  registerReviewerSignin(app, {
    env: { ...env, ...overrides },
    findUser: email => missing ? undefined : ({
      id: email === paidEmail ? 10 : 11, email, name: null, churchId: null,
      tier: email === paidEmail ? "enterprise" : "free",
    }),
    issueTokens: (_res, claims) => {
      if (failTokens) throw new Error("private configuration detail");
      issued.push(claims);
      return { accessToken: "test-access", refreshToken: "test-refresh", tokenType: "Bearer", expiresIn: "15m" };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return {
    issued,
    async post(body: unknown, versioned = true) {
      const response = await fetch(`http://127.0.0.1:${port}/api/${versioned ? "v1/" : ""}user/reviewer-signin`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return { response, body: await response.json() };
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

test("both demo identities use ordinary user sessions with the stored tier", async () => {
  const f = await fixture();
  try {
    for (const [email, password, tier] of [
      [paidEmail, paidPassword, "enterprise"], [freeEmail, freePassword, "free"],
    ]) {
      const { response, body } = await f.post({ email: ` ${email.toUpperCase()} `, password, tier: "admin" });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(body.user.email, email);
      assert.equal(body.accessToken, "test-access");
      assert.equal(body.refreshToken, "test-refresh");
      assert.equal((f.issued.at(-1) as { tier: string }).tier, tier);
      assert.equal(JSON.stringify(body).includes(password), false);
    }
    assert.equal((await f.post({ email: paidEmail, password: paidPassword }, false)).response.status, 200);
  } finally { await f.close(); }
});

test("wrong passwords, unknown emails, prototype keys, and malformed inputs fail closed", async () => {
  const f = await fixture();
  try {
    for (const body of [
      { email: paidEmail, password: "wrong" },
      { email: freeEmail, password: paidPassword },
      { email: "customer@example.com", password: paidPassword },
      { email: "constructor", password: paidPassword },
      { email: "__proto__", password: paidPassword },
      { email: paidEmail, password: "x".repeat(73) },
      { email: paidEmail, password: "é".repeat(37) },
      { email: [], password: paidPassword }, { email: paidEmail, password: {} }, {},
    ]) {
      const result = await f.post(body);
      assert.equal(result.response.status, 401);
      assert.deepEqual(result.body, { error: "Invalid reviewer email or password." });
    }
    assert.equal(f.issued.length, 0);
  } finally { await f.close(); }
});

test("disabled or missing/malformed hash configuration fails closed", async () => {
  for (const config of [
    { ENABLE_REVIEWER_SIGNIN: "false" },
    { REVIEWER_ENTERPRISE_PASSWORD_HASH: "" },
    { REVIEWER_FREE_PASSWORD_HASH: "plaintext-is-not-valid" },
  ]) {
    const f = await fixture(config);
    try {
      assert.equal((await f.post({ email: paidEmail, password: paidPassword })).response.status, 503);
      assert.equal(f.issued.length, 0);
    } finally { await f.close(); }
  }
});

test("missing demo account and token service failures return safe errors", async () => {
  for (const [missing, failTokens] of [[true, false], [false, true]]) {
    const f = await fixture({}, missing, failTokens);
    try {
      const result = await f.post({ email: paidEmail, password: paidPassword });
      assert.equal(result.response.status, 503);
      assert.equal(JSON.stringify(result.body).includes("private"), false);
    } finally { await f.close(); }
  }
});

test("rate limit stops attempts before credential verification and supplies retry guidance", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 20; i++) assert.equal((await f.post({})).response.status, 401);
    const result = await f.post({ email: paidEmail, password: paidPassword });
    assert.equal(result.response.status, 429);
    assert.ok(result.response.headers.get("retry-after"));
    assert.equal(f.issued.length, 0);
  } finally { await f.close(); }
});

test("production route bypasses admin gate and uses real storage and token issuer", () => {
  const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const publicPaths = source.slice(source.indexOf("const PUBLIC = ["), source.indexOf("];", source.indexOf("const PUBLIC = [")));
  assert.match(publicPaths, /"\/user\/reviewer-signin"/);
  assert.match(source, /registerReviewerSignin\(app,\s*\{\s*findUser: email => storage.getUserByEmail\(email\),\s*issueTokens: issueUserTokens,/);
});
