import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import Database from "better-sqlite3";
import { createWaitlistStore, CONSENT_VERSION, exportCsv, csvCell } from "./store";
import { registerWaitlist, type Welcome } from "./routes";
import path from "node:path";

const input = {
  email: "friend@example.com", firstName: "Friend", device: "iphone",
  consent: true, consentVersion: CONSENT_VERSION, website: "",
  source: "instagram", medium: "social", campaign: "launch", content: "video1",
};
async function fixture(env: NodeJS.ProcessEnv = { WAITLIST_ENABLED: "true", WAITLIST_EMAIL_ENABLED: "true" }, mailWorks = true) {
  const db = new Database(":memory:");
  const store = createWaitlistStore(db);
  const messages: Welcome[] = [];
  const app = express();
  app.use(express.json());
  registerWaitlist(app, {
    store, env, publicDir: path.resolve("my-shepherd-app/waitlist"),
    ownerGuard: (req, res, next) => req.header("authorization") === "owner-test-only" ? next() : res.sendStatus(401),
    sendWelcome: async message => { messages.push(message); return mailWorks; },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    db, store, messages, base,
    post: (body: unknown, endpoint = "") => fetch(`${base}/api/waitlist${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    close: async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); db.close(); },
  };
}

test("signup persists consent and attribution, normalizes email, sends exactly once", async () => {
  const f = await fixture();
  try {
    const response = await f.post({ ...input, email: " FRIEND@Example.com " });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(f.messages.length, 1);
    const rows = f.store.exportActive();
    assert.equal(rows[0].email, "friend@example.com");
    assert.equal(rows[0].device, "iphone");
    assert.equal(rows[0].consentVersion, CONSENT_VERSION);
    assert.equal(rows[0].emailStatus, "sent");
    assert.equal(rows[0].campaign, "launch");
    assert.ok(f.messages[0].unsubscribeUrl.startsWith("https://app.myshepherdapp.church/waitlist/#unsubscribe="));
    await Promise.all([f.post(input), f.post({ ...input, device: "android" })]);
    assert.equal(f.store.exportActive().length, 1);
    assert.equal(f.store.exportActive()[0].device, "iphone");
    assert.equal(f.messages.length, 1);
    const raw = JSON.stringify(f.db.prepare("SELECT * FROM launch_waitlist").all());
    assert.ok(!raw.includes(f.messages[0].unsubscribeUrl.split("=")[1]));
  } finally { await f.close(); }
});
test("requires email and explicit current consent; rejects unexpected or hostile fields", async () => {
  const f = await fixture();
  try {
    for (const body of [
      { ...input, email: "bad" }, { ...input, consent: false },
      { ...input, consentVersion: "old" }, { ...input, device: "tablet" },
      { ...input, firstName: "a".repeat(81) }, { ...input, firstName: "A\nB" },
      { ...input, source: "<script>" }, { ...input, password: "no-account-here" },
    ]) assert.equal((await f.post(body)).status, 400);
    assert.equal(f.store.exportActive().length, 0);
    assert.equal(f.messages.length, 0);
    assert.equal((await f.post({ email: "minimal@example.com", consent: true, consentVersion: CONSENT_VERSION })).status, 200);
  } finally { await f.close(); }
});
test("honeypot returns neutral success without creating contact or sending mail", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.post({ ...input, website: "bot.example" })).status, 200);
    assert.equal(f.store.exportActive().length, 0);
    assert.equal(f.messages.length, 0);
  } finally { await f.close(); }
});
test("disabled gate does not touch DB; email failure does not lose signup", async () => {
  const f = await fixture({});
  try {
    assert.equal((await f.post(input)).status, 503);
    assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='launch_waitlist'").get(), undefined);
  } finally { await f.close(); }
  const failed = await fixture({ WAITLIST_ENABLED: "true", WAITLIST_EMAIL_ENABLED: "true" }, false);
  try {
    assert.equal((await failed.post(input)).status, 200);
    assert.equal(failed.store.exportActive()[0].emailStatus, "failed");
  } finally { await failed.close(); }
  const disabled = await fixture({ WAITLIST_ENABLED: "true" });
  try {
    assert.equal((await disabled.post(input)).status, 200);
    assert.equal(disabled.store.exportActive()[0].emailStatus, "disabled");
    assert.equal(disabled.messages.length, 0);
  } finally { await disabled.close(); }
});
test("unsubscribe is POST-only, works while signups disabled, and cannot be reversed by public signup", async () => {
  const env = { WAITLIST_ENABLED: "true", WAITLIST_EMAIL_ENABLED: "true" };
  const f = await fixture(env);
  try {
    await f.post(input);
    const token = f.messages[0].unsubscribeUrl.split("=")[1];
    assert.equal((await fetch(`${f.base}/api/waitlist/unsubscribe?token=${token}`)).status, 404);
    assert.equal(f.store.exportActive().length, 1);
    assert.equal((await f.post({ token: "invalid" }, "/unsubscribe")).status, 400);
    env.WAITLIST_ENABLED = "false";
    assert.equal((await f.post({ token }, "/unsubscribe")).status, 200);
    assert.equal((await f.post({ token }, "/unsubscribe")).status, 200);
    assert.equal(f.store.exportActive().length, 0);
    env.WAITLIST_ENABLED = "true";
    await f.post(input);
    assert.equal(f.store.exportActive().length, 0);
    assert.equal(f.messages.length, 1);
    assert.equal(f.store.list().rows[0].status, "unsubscribed");
  } finally { await f.close(); }
});
test("private lists/CSV require auth and export omits opt-outs and tokens", async () => {
  const f = await fixture();
  try {
    await f.post(input);
    for (const endpoint of ["contacts", "export"]) {
      assert.equal((await fetch(`${f.base}/api/waitlist/${endpoint}`)).status, 401);
      const response = await fetch(`${f.base}/api/waitlist/${endpoint}`, { headers: { Authorization: "owner-test-only" } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.text();
      assert.ok(body.includes("friend@example.com"));
      assert.ok(!body.includes("unsubscribe_hash"));
    }
    assert.equal(csvCell(" =SUM(1,2)"), '"\' =SUM(1,2)"');
    assert.equal(csvCell('a"b'), '"a""b"');
    const token = f.messages[0].unsubscribeUrl.split("=")[1];
    await f.post({ token }, "/unsubscribe");
    assert.ok(!exportCsv(f.store.exportActive()).includes("friend@example.com"));
  } finally { await f.close(); }
});
test("rate limit rejects repeated requests without extra emails", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await f.post(input)).status, 200);
    const limited = await f.post(input);
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
    assert.equal(f.messages.length, 1);
  } finally { await f.close(); }
});
test("static waitlist loads separately and never imports existing app login JS", async () => {
  const f = await fixture();
  try {
    const response = await fetch(`${f.base}/waitlist/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("Notify me at launch"));
    assert.ok(!html.includes('src="../app.js"'));
    assert.ok(!html.includes("posthog"));
    assert.equal((await fetch(`${f.base}/waitlist/waitlist.js`)).status, 200);
  } finally { await f.close(); }
});
