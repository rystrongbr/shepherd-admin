import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import Database from "better-sqlite3";
import { deleteAppUserAccount, registerAccountDeletion, isProtectedReviewerEmail } from "./deletion";

const SCHEMA = `
CREATE TABLE app_users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, tier TEXT);
CREATE TABLE chats (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, topic TEXT);
CREATE TABLE chat_reactions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, chat_id INTEGER NOT NULL, reaction TEXT);
CREATE TABLE donation_prompts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, trigger TEXT);
CREATE TABLE donations (id INTEGER PRIMARY KEY, user_id INTEGER, email TEXT NOT NULL DEFAULT '', amount_cents INTEGER, prompt_id INTEGER);
CREATE TABLE member_signups (id INTEGER PRIMARY KEY, email TEXT UNIQUE, user_id INTEGER);
CREATE TABLE affiliations (id INTEGER PRIMARY KEY, email TEXT);
CREATE TABLE crisis_safety_signals (id INTEGER PRIMARY KEY, user_id INTEGER, category TEXT);
CREATE TABLE daily_question_counts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, date TEXT, count INTEGER);
CREATE TABLE auth_refresh_tokens (id INTEGER PRIMARY KEY, subject_type TEXT, subject_id INTEGER);
CREATE TABLE iap_transaction_owners (environment TEXT, original_transaction_id TEXT, user_id INTEGER NOT NULL);
CREATE TABLE launch_waitlist (id INTEGER PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE);
`;

function seed(db: Database.Database, id: number, email: string) {
  db.prepare("INSERT INTO app_users VALUES (?, ?, 'plus')").run(id, email);
  db.prepare("INSERT INTO chats VALUES (?, ?, 'love')").run(id * 10, id);
  db.prepare("INSERT INTO chat_reactions VALUES (?, ?, ?, 'up')").run(id * 10, id, id * 10);
  db.prepare("INSERT INTO donation_prompts VALUES (?, ?, 'x')").run(id * 10, id);
  db.prepare("INSERT INTO donations VALUES (?, ?, ?, 500, ?)").run(id * 10, id, email, id * 10);
  db.prepare("INSERT INTO member_signups VALUES (?, ?, ?)").run(id * 10, email, id);
  db.prepare("INSERT INTO affiliations VALUES (?, ?)").run(id * 10, email.toUpperCase());
  db.prepare("INSERT INTO crisis_safety_signals VALUES (?, ?, 'c')").run(id * 10, id);
  db.prepare("INSERT INTO daily_question_counts VALUES (?, ?, '2026-10-27', 3)").run(id * 10, id);
  db.prepare("INSERT INTO auth_refresh_tokens VALUES (?, 'user', ?)").run(id * 10, id);
  db.prepare("INSERT INTO auth_refresh_tokens VALUES (?, 'admin', ?)").run(id * 10 + 1, id); // admin id collision: keep
  db.prepare("INSERT INTO iap_transaction_owners VALUES ('Production', ?, ?)").run(`txn-${id}`, id);
  db.prepare("INSERT INTO launch_waitlist VALUES (?, ?)").run(id * 10, email);
}

function fixture() {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  seed(db, 1, "delete-me@example.com");
  seed(db, 2, "keep-me@example.com");
  return db;
}

const count = (db: Database.Database, sql: string, ...p: unknown[]) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).get(...p) as { n: number }).n;

test("deletes the user's account and personal data, and leaves other users alone", () => {
  const db = fixture();
  try {
    assert.deepEqual(deleteAppUserAccount(db, 1, "Delete-Me@example.com"), { deleted: true, demoAccountPreserved: false });
    for (const [t, col] of [["app_users", "id"], ["chats", "user_id"], ["chat_reactions", "user_id"], ["donation_prompts", "user_id"],
      ["member_signups", "user_id"], ["daily_question_counts", "user_id"], ["iap_transaction_owners", "user_id"]] as const) {
      assert.equal(count(db, `${t} WHERE ${col} = 1`), 0, t);
      assert.equal(count(db, `${t} WHERE ${col} = 2`), 1, `${t} (other user)`);
    }
    assert.equal(count(db, "affiliations WHERE lower(email) = 'delete-me@example.com'"), 0);
    assert.equal(count(db, "launch_waitlist WHERE email = 'delete-me@example.com'"), 0);
    assert.equal(count(db, "auth_refresh_tokens WHERE subject_type = 'user' AND subject_id = 1"), 0);
    assert.equal(count(db, "auth_refresh_tokens WHERE subject_type = 'admin' AND subject_id = 1"), 1);
    // Anonymized, not deleted.
    assert.deepEqual(db.prepare("SELECT user_id, email, amount_cents, prompt_id FROM donations WHERE id = 10").get(),
      { user_id: null, email: "", amount_cents: 500, prompt_id: null });
    assert.deepEqual(db.prepare("SELECT user_id FROM crisis_safety_signals WHERE id = 10").get(), { user_id: null });
    assert.equal(count(db, "donations WHERE user_id = 2 AND email = 'keep-me@example.com'"), 1);
  } finally { db.close(); }
});

test("reviewer demo accounts keep their account row and subscription state", () => {
  const db = fixture();
  const reviewer = "apple-review+free@myshepherdapp.church";
  try {
    assert.ok(isProtectedReviewerEmail(reviewer.toUpperCase()));
    seed(db, 3, reviewer);
    assert.deepEqual(deleteAppUserAccount(db, 3, reviewer), { deleted: true, demoAccountPreserved: true });
    assert.equal(count(db, "app_users WHERE id = 3"), 1);
    assert.equal(count(db, "iap_transaction_owners WHERE user_id = 3"), 1);
    assert.equal(count(db, "chats WHERE user_id = 3"), 0);
    assert.equal(count(db, "auth_refresh_tokens WHERE subject_type = 'user' AND subject_id = 3"), 0);
  } finally { db.close(); }
});

test("works when optional tables do not exist yet", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE app_users (id INTEGER PRIMARY KEY, email TEXT UNIQUE)");
    db.prepare("INSERT INTO app_users VALUES (1, 'a@example.com')").run();
    deleteAppUserAccount(db, 1, "a@example.com");
    assert.equal(count(db, "app_users"), 0);
  } finally { db.close(); }
});

test("DELETE /api/v1/user/me requires sign-in and an explicit confirmation", async () => {
  const db = fixture();
  const logs: string[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.url = req.url.replace(/^\/api\/v1\//, "/api/"); next(); });
  registerAccountDeletion(app, {
    db,
    log: m => logs.push(m),
    requireUser: (req, res, next) => {
      if (req.header("authorization") !== "Bearer user-1") return res.status(401).json({ error: "Authentication required" });
      (req as any).user = { id: 1, email: "delete-me@example.com", tier: "plus" };
      next();
    },
  });
  const server = app.listen(0);
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/v1/user/me`;
  const call = (headers: Record<string, string>, body?: unknown) =>
    fetch(url, { method: "DELETE", headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await call({}, { confirm: "DELETE" })).status, 401);
    assert.equal((await call({ authorization: "Bearer user-1" })).status, 400);
    assert.equal((await call({ authorization: "Bearer user-1" }, { confirm: "yes" })).status, 400);
    assert.equal(count(db, "app_users WHERE id = 1"), 1);
    const ok = await call({ authorization: "Bearer user-1" }, { confirm: "DELETE" });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.deepEqual(await ok.json(), { deleted: true, demoAccountPreserved: false });
    assert.equal(count(db, "app_users WHERE id = 1"), 0);
    assert.ok(logs.every(l => !l.includes("@")), "logs never contain the email address");
  } finally { server.close(); db.close(); }
});
