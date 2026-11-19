import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";

process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "marketing-metrics-isolated-test-secret-not-production";

const TOKEN = "mm_test_token_0123456789abcdefghijklmnop";
const NOW = new Date("2026-11-19T15:00:00.000Z");
const day = (offset: number) => {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString();
};

async function setup() {
  const { sqlite } = await import("../storage");
  const { requireAdmin } = await import("../auth");
  const { ensureQuotaTables } = await import("../rate-limits");
  const { createWaitlistStore } = await import("../waitlist/store");
  const { registerMarketingMetrics } = await import("./marketing");
  ensureQuotaTables();
  return { sqlite, requireAdmin, ensureQuotaTables, createWaitlistStore, registerMarketingMetrics };
}

let seeded = false;
async function seed() {
  const { sqlite, createWaitlistStore } = await setup();
  if (seeded) return sqlite;
  seeded = true;
  const insertUser = sqlite.prepare(`INSERT INTO app_users
    (email, name, google_id, created_at, last_login_at, tier, subscription_product_id,
     subscription_expires_at, subscription_platform, is_test_user, zip_code, home_church_name, church_id)
    VALUES (@email, @name, @google, @created, @created, @tier, @product, @expires, @platform, @test, @zip, @church, @churchId)`);
  const base = { google: "", tier: "free", product: null, expires: null, platform: null, test: 0, zip: null, church: null, churchId: null };
  const ids: Record<string, number> = {};
  const add = (key: string, row: Partial<typeof base> & { email: string; name: string; created: string }) => {
    ids[key] = Number(insertUser.run({ ...base, ...row }).lastInsertRowid);
  };
  add("freeA", { email: "alice.secret@example.com", name: "Alice Secretname", created: day(0), zip: "90210", church: "Hidden Chapel" });
  add("freeB", { email: "bob.secret@example.com", name: "Bob Secretname", created: day(1), google: "google-sub-123" });
  add("plusApple", { email: "carol.secret@example.com", name: "Carol", created: day(5), tier: "plus",
    product: "church.myshepherdapp.plus.monthly", expires: day(-20), platform: "apple" });
  add("plusGoogle", { email: "dan.secret@example.com", name: "Dan", created: day(3), tier: "plus",
    product: "church.myshepherdapp.plus.yearly", expires: day(-300), platform: "google" });
  // Expired store subscription two days ago, never renewed: counts as free + a lapse.
  add("lapsed", { email: "erin.secret@example.com", name: "Erin", created: day(40), tier: "plus",
    product: "church.myshepherdapp.plus.monthly", expires: day(2), platform: null });
  add("manualEnt", { email: "frank.secret@example.com", name: "Frank", created: day(400), tier: "enterprise", churchId: 1 });
  // Internal accounts — excluded by default.
  add("reviewer", { email: "apple-review+plus@myshepherdapp.church", name: "Reviewer", created: day(0), tier: "plus" });
  add("tester", { email: "qa.secret@example.com", name: "QA", created: day(0), test: 1 });

  const q = sqlite.prepare(`INSERT INTO daily_question_counts (user_id, date, count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)`);
  const d0 = day(0).slice(0, 10), d1 = day(1).slice(0, 10);
  q.run(ids.freeA, d0, 3, day(0), day(0));      // free at limit
  q.run(ids.freeB, d0, 1, day(0), day(0));
  q.run(ids.plusApple, d0, 20, day(0), day(0)); // plus at limit
  q.run(ids.plusGoogle, d1, 5, day(1), day(1));
  q.run(ids.reviewer, d0, 20, day(0), day(0));  // internal: excluded

  const ins = sqlite.prepare(`INSERT INTO insights (topic, question, session_id, created_at) VALUES (?, ?, ?, ?)`);
  ins.run("anxiety", "PRIVATE QUESTION TEXT about my life", "anon-session-uuid-1", day(0));
  ins.run("anxiety", "PRIVATE QUESTION TEXT again", "anon-session-uuid-1", day(0));
  ins.run("hope", "PRIVATE QUESTION TEXT 3", "anon-session-uuid-2", day(0));
  ins.run("hope", "PRIVATE QUESTION TEXT 4", `user-${ids.freeA}`, day(0));

  sqlite.prepare(`INSERT INTO donations (email, stripe_session_id, amount_cents, currency, frequency, status, created_at, completed_at)
    VALUES (?, ?, ?, 'usd', ?, ?, ?, ?)`).run("donor.secret@example.com", "cs_test_private_1", 2500, "one_time", "completed", day(1), day(1));
  sqlite.prepare(`INSERT INTO donations (email, stripe_session_id, amount_cents, currency, frequency, status, created_at, completed_at)
    VALUES (?, ?, ?, 'usd', ?, ?, ?, '')`).run("donor2.secret@example.com", "cs_test_private_2", 9900, "one_time", "pending", day(0));

  sqlite.prepare(`INSERT INTO member_signups (email, zip_code, source, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, '203.0.113.9', 'UA', ?)`).run("lead.secret@example.com", "30301", "app_first_visit_modal", day(0));

  const store = createWaitlistStore(sqlite);
  for (const [email, device, source] of [["w1.secret@example.com", "iphone", "podcast"], ["w2.secret@example.com", "android", "podcast"], ["w3.secret@example.com", "iphone", ""]] as const) {
    store.insert({ email, firstName: "Wfirst", device, source, medium: "audio", campaign: "launch", content: "" });
  }
  return sqlite;
}

async function start(env: NodeJS.ProcessEnv) {
  const { sqlite, requireAdmin, registerMarketingMetrics } = await setup();
  await seed();
  const app = express();
  registerMarketingMetrics(app, { sqlite, requireAdmin, env, now: () => NOW });
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

async function call(server: Server, path: string, auth?: string) {
  const port = (server.address() as { port: number }).port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: auth ? { authorization: auth } : {} });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const adminJwt = () => `Bearer ${jwt.sign({ kind: "admin", id: 1, email: "owner@example.com", role: "owner" }, process.env.JWT_SECRET!)}`;
const userJwt = () => `Bearer ${jwt.sign({ kind: "user", id: 1, email: "u@example.com", tier: "free" }, process.env.JWT_SECRET!)}`;

test("rejects anonymous, user tokens, wrong tokens, and disables the token path when unset or short", async () => {
  const server = await start({ MARKETING_METRICS_TOKEN: TOKEN });
  try {
    assert.equal((await call(server, "/api/admin/metrics/marketing")).status, 401);
    assert.equal((await call(server, "/api/admin/metrics/marketing", "Bearer wrong")).status, 401);
    assert.equal((await call(server, "/api/admin/metrics/marketing", userJwt())).status, 401);
    assert.equal((await call(server, "/api/admin/metrics/marketing", `Bearer ${TOKEN}x`)).status, 401);
  } finally { server.close(); }
  for (const env of [{}, { MARKETING_METRICS_TOKEN: "" }, { MARKETING_METRICS_TOKEN: "short" }]) {
    const s = await start(env);
    try {
      const value = (env as any).MARKETING_METRICS_TOKEN ?? TOKEN;
      assert.equal((await call(s, "/api/admin/metrics/marketing", `Bearer ${value}`)).status, 401);
      assert.equal((await call(s, "/api/admin/metrics/marketing", "Bearer ")).status, 401);
    } finally { s.close(); }
  }
});

test("accepts the existing admin session and the marketing token; validates days", async () => {
  const server = await start({ MARKETING_METRICS_TOKEN: TOKEN });
  try {
    const viaAdmin = await call(server, "/api/admin/metrics/marketing", adminJwt());
    assert.equal(viaAdmin.status, 200);
    assert.equal(viaAdmin.headers.get("cache-control"), "no-store");
    const viaToken = await call(server, "/api/admin/metrics/marketing?days=7", `Bearer ${TOKEN}`);
    assert.equal(viaToken.status, 200);
    assert.equal(viaToken.body.window.days, 7);
    assert.equal(viaToken.body.daily.length, 7);
    assert.equal(viaAdmin.body.daily.length, 30);
    const capped = await call(server, "/api/admin/metrics/marketing?days=9999", `Bearer ${TOKEN}`);
    assert.equal(capped.body.window.days, 365);
    assert.equal(capped.body.daily.length, 365);
    for (const bad of ["0", "-1", "abc", "1.5", "30;DROP"]) {
      assert.equal((await call(server, `/api/admin/metrics/marketing?days=${encodeURIComponent(bad)}`, `Bearer ${TOKEN}`)).status, 400, bad);
    }
  } finally { server.close(); }
});

test("returns correct aggregates and excludes internal accounts by default", async () => {
  const server = await start({ MARKETING_METRICS_TOKEN: TOKEN });
  try {
    const { body } = await call(server, "/api/admin/metrics/marketing?days=30", `Bearer ${TOKEN}`);
    assert.deepEqual(body.window, { days: 30, startDate: "2026-10-21", endDate: "2026-11-19", timezone: "UTC" });
    assert.equal(body.filters.excludedInternalUsers, 2);
    assert.equal(body.totals.users, 6);
    assert.deepEqual(body.totals.usersByTier, { free: 3, plus: 2, enterprise: 1 });
    assert.equal(body.totals.paidUsers, 3);
    assert.equal(body.totals.paidShareOfUsers, 0.5);
    assert.deepEqual(body.totals.usersByAuthMethod, { google: 1, emailMagicLink: 5 });
    assert.equal(body.totals.usersWithChurchAffiliation, 1);
    assert.equal(body.totals.usersWithHomeChurchName, 1);
    assert.deepEqual(body.subscriptions.activeByProduct, {
      "church.myshepherdapp.plus.monthly": 1, "church.myshepherdapp.plus.yearly": 1,
    });
    assert.deepEqual(body.subscriptions.activeByPlatform, { apple: 1, google: 1 });
    assert.deepEqual(body.subscriptions.manualGrants, { plus: 0, enterprise: 1 });
    assert.equal(body.subscriptions.lapsedAllTime, 1);

    const byDate = Object.fromEntries(body.daily.map((d: any) => [d.date, d]));
    const today = byDate["2026-11-19"], yesterday = byDate["2026-11-18"];
    assert.equal(today.signups, 1);
    assert.equal(yesterday.signups, 1);
    assert.equal(today.activeAskers, 3);
    assert.equal(today.signedInQuestions, 24);
    assert.equal(today.usersAtDailyLimit, 2);
    assert.equal(yesterday.activeAskers, 1);
    assert.equal(yesterday.usersAtDailyLimit, 0);
    assert.equal(today.webQuestions, 4);
    assert.equal(today.webQuestionsSignedIn, 1);
    assert.equal(today.webQuestionsAnonymous, 3);
    assert.equal(today.webAnonymousSessions, 2);
    assert.equal(byDate["2026-11-17"].subscriptionLapses, 1);
    assert.equal(yesterday.donations, 1);
    assert.equal(yesterday.donationAmountCents, 2500);
    assert.equal(today.donations, 0);
    assert.equal(today.stayConnectedSignups, 1);
    assert.equal(today.waitlistSignups, 3);

    assert.equal(body.windowTotals.signups, 4); // freeA, freeB, plusApple, plusGoogle
    assert.equal(body.windowTotals.activeAskers, 4);
    assert.deepEqual(body.donations.amountCentsByCurrency, { usd: 2500 });
    assert.deepEqual(body.attribution.stayConnectedSignupsBySource, { app_first_visit_modal: 1 });
    assert.deepEqual(body.attribution.launchWaitlist.bySource, { podcast: 2, "(none)": 1 });
    assert.deepEqual(body.attribution.launchWaitlist.byDevice, { iphone: 2, android: 1 });
    assert.equal(body.attribution.launchWaitlist.totalSubscribed, 3);
    assert.ok(Array.isArray(body.notDerivable) && body.notDerivable.length > 0);

    const all = await call(server, "/api/admin/metrics/marketing?days=30&includeInternal=true", `Bearer ${TOKEN}`);
    assert.equal(all.body.totals.users, 8);
    assert.equal(all.body.filters.excludedInternalUsers, 0);
    assert.equal(all.body.daily.find((d: any) => d.date === "2026-11-19").usersAtDailyLimit, 3);
  } finally { server.close(); }
});

test("response contains no PII or identifiers and the database is not modified", async () => {
  const server = await start({ MARKETING_METRICS_TOKEN: TOKEN });
  const sqlite = await seed();
  try {
    const snapshot = () => JSON.stringify(sqlite.prepare(`SELECT
      (SELECT COUNT(*) FROM app_users) a, (SELECT group_concat(tier) FROM app_users) t,
      (SELECT COUNT(*) FROM daily_question_counts) q, (SELECT COUNT(*) FROM insights) i,
      (SELECT COUNT(*) FROM donations) d, (SELECT COUNT(*) FROM launch_waitlist) w`).get());
    const before = snapshot();
    const changesBefore = sqlite.prepare("SELECT total_changes() AS n").get();
    const { text } = await call(server, "/api/admin/metrics/marketing?days=365&includeInternal=true", `Bearer ${TOKEN}`);
    for (const needle of ["secret@", "@example.com", "myshepherdapp.church\"", "Secretname", "PRIVATE", "90210", "30301",
      "Hidden Chapel", "anon-session", "user-", "google-sub", "cs_test", "203.0.113", "Wfirst"]) {
      assert.ok(!text.includes(needle), `response leaked ${needle}`);
    }
    assert.equal(snapshot(), before);
    assert.deepEqual(sqlite.prepare("SELECT total_changes() AS n").get(), changesBefore);
  } finally { server.close(); }
});

test("missing lazily created tables yield zeros instead of errors", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { computeMarketingMetrics } = await import("./marketing");
  const empty = new Database(":memory:");
  const result = computeMarketingMetrics(empty, { days: 3, includeInternal: false, now: NOW });
  assert.equal(result.totals.users, 0);
  assert.equal(result.daily.length, 3);
  assert.equal(result.attribution.launchWaitlist.available, false);
});

test("wired into the real route table ahead of the /api admin gate; the token unlocks nothing else", async () => {
  process.env.MARKETING_METRICS_TOKEN = TOKEN;
  // routes.ts constructs AI clients at import time; no network calls are made here.
  process.env.OPENAI_API_KEY ??= "test-key-not-used";
  process.env.ANTHROPIC_API_KEY ??= "test-key-not-used";
  try {
    const { registerRoutes } = await import("../routes");
    const app = express();
    app.use(express.json());
    const server = createServer(app);
    await registerRoutes(server, app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      assert.equal((await call(server, "/api/admin/metrics/marketing?days=2", `Bearer ${TOKEN}`)).status, 200);
      assert.equal((await call(server, "/api/admin/metrics/marketing", adminJwt())).status, 200);
      assert.equal((await call(server, "/api/admin/metrics/marketing")).status, 401);
      // Other admin-only routes still reject the marketing token.
      assert.equal((await call(server, "/api/member-signups/count", `Bearer ${TOKEN}`)).status, 401);
      assert.equal((await call(server, "/api/insights/qa", `Bearer ${TOKEN}`)).status, 401);
      assert.equal((await call(server, "/api/health")).status, 200);
    } finally { server.close(); }
  } finally { delete process.env.MARKETING_METRICS_TOKEN; }
});
