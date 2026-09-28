import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";

const OWNER_EMAIL = "ryan@myshepherdapp.church";
type ResetResult = "disabled" | "invalid-configuration" | "owner-unavailable" | "already-applied" | "applied" | "failed";

/**
 * Operator-only startup recovery. No HTTP endpoint; Railway variable access
 * is required. Never log password, hash, SQL error details, or environment.
 * Access JWTs retain their existing expiry; only refresh sessions are revoked.
 */
export function applyOwnerPasswordReset(
  sqlite: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
): ResetResult {
  const resetId = env.OWNER_PASSWORD_RESET_ID;
  const password = env.OWNER_PASSWORD_RESET_PASSWORD;
  // Remove plaintext from the process environment as soon as it is read.
  // The operator must still delete the saved Railway variables after recovery.
  delete env.OWNER_PASSWORD_RESET_PASSWORD;
  if (resetId === undefined && password === undefined) return "disabled";
  if (
    !resetId || !/^[a-zA-Z0-9_-]{16,80}$/.test(resetId) ||
    !password || password.length < 20 || Buffer.byteLength(password, "utf8") > 72 ||
    password.trim() !== password
  ) return "invalid-configuration";

  try {
    return sqlite.transaction((): ResetResult => {
      const exists = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_users'",
      ).get();
      if (!exists) return "owner-unavailable";
      const owners = sqlite.prepare(
        "SELECT id, role, is_active FROM admin_users WHERE lower(email) = ?",
      ).all(OWNER_EMAIL) as Array<{ id: number; role: string; is_active: number }>;
      if (owners.length !== 1 || owners[0].role !== "owner" || owners[0].is_active !== 1) {
        return "owner-unavailable";
      }
      const owner = owners[0];
      sqlite.exec(`CREATE TABLE IF NOT EXISTS owner_password_reset_audit (
        reset_id TEXT PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        applied_at TEXT NOT NULL
      )`);
      if (sqlite.prepare("SELECT reset_id FROM owner_password_reset_audit WHERE reset_id = ?").get(resetId)) {
        return "already-applied";
      }
      const now = new Date().toISOString();
      const passwordHash = bcrypt.hashSync(password, 12);
      sqlite.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(passwordHash, owner.id);
      const refreshTable = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_refresh_tokens'",
      ).get();
      if (refreshTable) {
        sqlite.prepare(`UPDATE auth_refresh_tokens SET revoked_at = ?
          WHERE subject_type = 'admin' AND subject_id = ? AND revoked_at IS NULL`).run(now, owner.id);
      }
      sqlite.prepare("INSERT INTO owner_password_reset_audit (reset_id, admin_id, applied_at) VALUES (?, ?, ?)")
        .run(resetId, owner.id, now);
      return "applied";
    }).immediate();
  } catch {
    // A failed recovery must not take consumer/reviewer routes offline.
    // SQLite transaction rolls back both password and session updates.
    return "failed";
  }
}

export function runOwnerPasswordReset(
  sqlite: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = console.info,
): ResetResult {
  const result = applyOwnerPasswordReset(sqlite, env);
  if (result !== "disabled") log(`[owner-password-reset] ${result}`);
  return result;
}
