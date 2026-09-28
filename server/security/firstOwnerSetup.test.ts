import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { applyOwnerPasswordReset, runOwnerPasswordReset } from "./ownerPasswordReset";

const password = "first-owner-test-password-only";
const env = () => ({
  OWNER_PASSWORD_RESET_ID: "first-owner-test-20260928",
  OWNER_PASSWORD_RESET_PASSWORD: password,
  OWNER_PASSWORD_RESET_ALLOW_FIRST_OWNER: "true",
});
function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL,
      last_login_at TEXT, is_active INTEGER NOT NULL);
    CREATE TABLE app_users (id INTEGER PRIMARY KEY, email TEXT, tier TEXT);
    CREATE TABLE auth_refresh_tokens (id INTEGER PRIMARY KEY, subject_type TEXT, subject_id INTEGER, revoked_at TEXT);
    CREATE TABLE launch_waitlist (id INTEGER PRIMARY KEY, email TEXT, status TEXT);
    INSERT INTO app_users VALUES
      (1, 'apple-review@myshepherdapp.church', 'enterprise'),
      (2, 'apple-review+free@myshepherdapp.church', 'free');
    INSERT INTO auth_refresh_tokens VALUES (1, 'user', 1, NULL), (2, 'user', 2, NULL);
    INSERT INTO launch_waitlist VALUES (1, 'test@example.com', 'subscribed');
  `);
  return db;
}
function customers(db: Database.Database) {
  return ["app_users", "auth_refresh_tokens", "launch_waitlist"].map(table =>
    db.prepare(`SELECT * FROM ${table}`).all());
}

test("explicit first-owner mode creates only the fixed active owner and preserves consumer data", () => {
  const db = fixture();
  try {
    const before = customers(db);
    const config = env();
    const logs: string[] = [];
    assert.equal(runOwnerPasswordReset(db, config, text => logs.push(text)), "owner-created");
    const rows = db.prepare("SELECT * FROM admin_users").all() as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "ryan@myshepherdapp.church");
    assert.equal(rows[0].role, "owner");
    assert.equal(rows[0].is_active, 1);
    assert.equal(bcrypt.compareSync(password, rows[0].password_hash), true);
    assert.equal(bcrypt.getRounds(rows[0].password_hash), 12);
    assert.ok(rows[0].created_at);
    assert.equal(config.OWNER_PASSWORD_RESET_PASSWORD, undefined);
    assert.deepEqual(customers(db), before);
    assert.deepEqual(logs, ["[owner-password-reset] owner-created"]);
    assert.equal((db.prepare("SELECT admin_id FROM owner_password_reset_audit").get() as any).admin_id, rows[0].id);
  } finally { db.close(); }
});

test("absent or non-exact first-owner flag never creates an administrator", () => {
  for (const flag of [undefined, "", "false", "TRUE", "1"]) {
    const db = fixture();
    try {
      const before = db.serialize();
      assert.equal(applyOwnerPasswordReset(db, { ...env(), OWNER_PASSWORD_RESET_ALLOW_FIRST_OWNER: flag }), "owner-unavailable");
      assert.deepEqual(db.serialize(), before);
    } finally { db.close(); }
  }
});

test("first-owner mode refuses every existing account, including inactive and non-owner targets", () => {
  for (const [email, role, active] of [
    ["ryan@myshepherdapp.church", "admin", 1],
    ["ryan@myshepherdapp.church", "owner", 0],
    ["ryan@myshepherdapp.church", "owner", 1],
    ["other@example.com", "admin", 1],
  ] as const) {
    const db = fixture();
    try {
      db.prepare("INSERT INTO admin_users (email,password_hash,role,created_at,is_active) VALUES (?,?,?,?,?)")
        .run(email, "unchanged-test-hash", role, "test-date", active);
      const before = db.serialize();
      assert.equal(applyOwnerPasswordReset(db, env()), "bootstrap-refused");
      assert.deepEqual(db.serialize(), before);
    } finally { db.close(); }
  }
});

test("restarts and reused IDs cannot overwrite or recreate the first owner", () => {
  const db = fixture();
  try {
    assert.equal(applyOwnerPasswordReset(db, env()), "owner-created");
    const first = db.serialize();
    assert.equal(applyOwnerPasswordReset(db, { ...env(), OWNER_PASSWORD_RESET_PASSWORD: "different-first-owner-test-password" }), "already-applied");
    assert.deepEqual(db.serialize(), first);
    assert.equal(applyOwnerPasswordReset(db, { ...env(), OWNER_PASSWORD_RESET_ID: "different-operation-20260928" }), "bootstrap-refused");
    assert.deepEqual(db.serialize(), first);
    db.exec("DELETE FROM admin_users");
    const deleted = db.serialize();
    assert.equal(applyOwnerPasswordReset(db, env()), "already-applied");
    assert.equal(applyOwnerPasswordReset(db, { ...env(), OWNER_PASSWORD_RESET_ID: "different-operation-20260928" }), "bootstrap-refused");
    assert.deepEqual(db.serialize(), deleted);
  } finally { db.close(); }
});

test("failed audit insert rolls back owner creation and all consumer data stays unchanged", () => {
  const db = fixture();
  try {
    db.exec(`CREATE TABLE owner_password_reset_audit (reset_id TEXT PRIMARY KEY, admin_id INTEGER, applied_at TEXT);
      CREATE TRIGGER block_audit BEFORE INSERT ON owner_password_reset_audit
      BEGIN SELECT RAISE(ABORT, 'test-private-error'); END`);
    const before = db.serialize();
    const logs: string[] = [];
    assert.equal(runOwnerPasswordReset(db, env(), text => logs.push(text)), "failed");
    assert.deepEqual(db.serialize(), before);
    assert.deepEqual(logs, ["[owner-password-reset] failed"]);
  } finally { db.close(); }
});

test("first-owner mode still requires a valid password, operation ID and existing admin schema", () => {
  for (const overrides of [
    { OWNER_PASSWORD_RESET_PASSWORD: "" },
    { OWNER_PASSWORD_RESET_PASSWORD: "too-short" },
    { OWNER_PASSWORD_RESET_PASSWORD: "a".repeat(73) },
    { OWNER_PASSWORD_RESET_ID: "" },
  ]) {
    const db = fixture();
    try {
      const before = db.serialize();
      assert.equal(applyOwnerPasswordReset(db, { ...env(), ...overrides }), "invalid-configuration");
      assert.deepEqual(db.serialize(), before);
    } finally { db.close(); }
  }
  const db = fixture();
  try {
    db.exec("DROP TABLE admin_users");
    const before = db.serialize();
    assert.equal(applyOwnerPasswordReset(db, env()), "owner-unavailable");
    assert.deepEqual(db.serialize(), before);
  } finally { db.close(); }
});
