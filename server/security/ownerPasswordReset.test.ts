import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { applyOwnerPasswordReset, runOwnerPasswordReset } from "./ownerPasswordReset";

const email = "ryan@myshepherdapp.church";
const oldPassword = "old-owner-test-password-only";
const newPassword = "new-owner-test-password-only";
const oldHash = bcrypt.hashSync(oldPassword, 4);
const configuration = () => ({
  OWNER_PASSWORD_RESET_ID: "owner-reset-20260928-01",
  OWNER_PASSWORD_RESET_PASSWORD: newPassword,
});

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE admin_users (id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT, role TEXT, is_active INTEGER);
    CREATE TABLE auth_refresh_tokens (id INTEGER PRIMARY KEY, subject_type TEXT, subject_id INTEGER, revoked_at TEXT);
    CREATE TABLE app_users (id INTEGER PRIMARY KEY, email TEXT, tier TEXT);
    CREATE TABLE launch_waitlist (id INTEGER PRIMARY KEY, email TEXT, status TEXT);
  `);
  db.prepare("INSERT INTO admin_users VALUES (1, ?, ?, 'owner', 1)").run(email, oldHash);
  db.prepare("INSERT INTO admin_users VALUES (2, 'church@example.com', ?, 'admin', 1)").run(oldHash);
  db.exec(`
    INSERT INTO auth_refresh_tokens VALUES
      (1, 'admin', 1, NULL), (2, 'admin', 2, NULL),
      (3, 'user', 1, NULL), (4, 'user', 2, NULL), (5, 'admin', 1, 'previous-revocation');
    INSERT INTO app_users VALUES
      (1, 'apple-review@myshepherdapp.church', 'enterprise'),
      (2, 'apple-review+free@myshepherdapp.church', 'free');
    INSERT INTO launch_waitlist VALUES (1, 'test@example.com', 'subscribed');
  `);
  return db;
}
function hash(db: Database.Database) {
  return (db.prepare("SELECT password_hash FROM admin_users WHERE id = 1").get() as any).password_hash as string;
}

test("disabled recovery makes no schema or data changes", () => {
  const db = fixture();
  try {
    const before = db.serialize();
    assert.equal(applyOwnerPasswordReset(db, {}), "disabled");
    assert.deepEqual(db.serialize(), before);
  } finally { db.close(); }
});

test("changes only the owner hash and owner refresh sessions, preserving reviewer users and waitlist", () => {
  const db = fixture();
  try {
    const users = db.prepare("SELECT * FROM app_users").all();
    const list = db.prepare("SELECT * FROM launch_waitlist").all();
    const env = configuration();
    assert.equal(applyOwnerPasswordReset(db, env), "applied");
    assert.equal(env.OWNER_PASSWORD_RESET_PASSWORD, undefined);
    assert.equal(bcrypt.compareSync(newPassword, hash(db)), true);
    assert.equal(bcrypt.compareSync(oldPassword, hash(db)), false);
    assert.equal((db.prepare("SELECT password_hash FROM admin_users WHERE id = 2").get() as any).password_hash, oldHash);
    assert.deepEqual(db.prepare("SELECT * FROM app_users").all(), users);
    assert.deepEqual(db.prepare("SELECT * FROM launch_waitlist").all(), list);
    const tokens = db.prepare("SELECT * FROM auth_refresh_tokens ORDER BY id").all() as any[];
    assert.ok(tokens[0].revoked_at);
    assert.deepEqual(tokens.slice(1).map(row => row.revoked_at), [null, null, null, "previous-revocation"]);
    const audit = db.prepare("SELECT * FROM owner_password_reset_audit").get() as any;
    assert.deepEqual(Object.keys(audit).sort(), ["admin_id", "applied_at", "reset_id"]);
    assert.equal(audit.admin_id, 1);
  } finally { db.close(); }
});

test("the same reset ID is never replayed across restarts or changed passwords", () => {
  const db = fixture();
  try {
    assert.equal(applyOwnerPasswordReset(db, configuration()), "applied");
    const current = hash(db);
    db.exec("INSERT INTO auth_refresh_tokens VALUES (6, 'admin', 1, NULL)");
    assert.equal(applyOwnerPasswordReset(db, {
      ...configuration(), OWNER_PASSWORD_RESET_PASSWORD: "another-test-password-for-replay",
    }), "already-applied");
    assert.equal(hash(db), current);
    assert.equal((db.prepare("SELECT revoked_at FROM auth_refresh_tokens WHERE id = 6").get() as any).revoked_at, null);
    assert.equal(applyOwnerPasswordReset(db, {}), "disabled");
    assert.equal(hash(db), current);
  } finally { db.close(); }
});

test("invalid or partial configuration is rejected without mutation or plaintext logging", () => {
  for (const config of [
    { OWNER_PASSWORD_RESET_ID: configuration().OWNER_PASSWORD_RESET_ID },
    { OWNER_PASSWORD_RESET_PASSWORD: newPassword },
    { ...configuration(), OWNER_PASSWORD_RESET_ID: "bad id" },
    { ...configuration(), OWNER_PASSWORD_RESET_PASSWORD: "short" },
    { ...configuration(), OWNER_PASSWORD_RESET_PASSWORD: "a".repeat(73) },
    { ...configuration(), OWNER_PASSWORD_RESET_PASSWORD: "é".repeat(37) },
    { ...configuration(), OWNER_PASSWORD_RESET_PASSWORD: ` ${newPassword}` },
  ]) {
    const db = fixture();
    try {
      const before = db.serialize();
      const logs: string[] = [];
      assert.equal(runOwnerPasswordReset(db, config, text => logs.push(text)), "invalid-configuration");
      assert.deepEqual(db.serialize(), before);
      assert.deepEqual(logs, ["[owner-password-reset] invalid-configuration"]);
      assert.equal(config.OWNER_PASSWORD_RESET_PASSWORD, undefined);
    } finally { db.close(); }
  }
});

test("missing, disabled, non-owner or ambiguous owner accounts are never created, enabled or promoted", () => {
  for (const mutation of [
    "DELETE FROM admin_users WHERE id = 1",
    "UPDATE admin_users SET is_active = 0 WHERE id = 1",
    "UPDATE admin_users SET role = 'admin' WHERE id = 1",
    "INSERT INTO admin_users SELECT 3, upper(email), password_hash, role, is_active FROM admin_users WHERE id = 1",
    "DROP TABLE admin_users",
  ]) {
    const db = fixture();
    try {
      db.exec(mutation);
      const before = db.serialize();
      assert.equal(applyOwnerPasswordReset(db, configuration()), "owner-unavailable");
      assert.deepEqual(db.serialize(), before);
    } finally { db.close(); }
  }
});

test("database failure rolls back password, sessions and audit with a sanitized log", () => {
  const db = fixture();
  try {
    db.exec(`CREATE TRIGGER prevent_revoke BEFORE UPDATE ON auth_refresh_tokens
      BEGIN SELECT RAISE(ABORT, 'private database detail'); END`);
    const before = db.serialize();
    const logs: string[] = [];
    assert.equal(runOwnerPasswordReset(db, configuration(), text => logs.push(text)), "failed");
    assert.deepEqual(db.serialize(), before);
    assert.deepEqual(logs, ["[owner-password-reset] failed"]);
  } finally { db.close(); }
});

test("applied log contains only a status, and recovery also works before any refresh session exists", () => {
  const db = fixture();
  try {
    db.exec("DROP TABLE auth_refresh_tokens");
    const logs: string[] = [];
    assert.equal(runOwnerPasswordReset(db, configuration(), text => logs.push(text)), "applied");
    assert.deepEqual(logs, ["[owner-password-reset] applied"]);
    assert.equal(bcrypt.compareSync(newPassword, hash(db)), true);
  } finally { db.close(); }
});
