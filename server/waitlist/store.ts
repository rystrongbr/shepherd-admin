import type Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";

export const CONSENT_VERSION = "launch-updates-2026-09-28";
export type Signup = {
  email: string; firstName: string; device: "" | "iphone" | "android";
  source: string; medium: string; campaign: string; content: string;
};
export type Contact = Signup & {
  id: number; createdAt: string; consentVersion: string;
  status: "subscribed" | "unsubscribed";
  emailStatus: "pending" | "sent" | "failed" | "disabled";
};
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const columns = `id, email, first_name AS firstName, device, source, medium,
  campaign, content, created_at AS createdAt, consent_version AS consentVersion,
  status, email_status AS emailStatus`;

// Separate additive table only. Never reads or writes app users, tiers, auth,
// subscriptions, church members, or the existing email automation tables.
export function createWaitlistStore(db: Database.Database) {
  let ready = false;
  function init() {
    if (ready) return;
    db.exec(`CREATE TABLE IF NOT EXISTS launch_waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      first_name TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '', medium TEXT NOT NULL DEFAULT '',
      campaign TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, consent_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'subscribed',
      email_status TEXT NOT NULL DEFAULT 'pending',
      unsubscribe_hash TEXT NOT NULL UNIQUE, unsubscribed_at TEXT
    )`);
    ready = true;
  }
  return {
    insert(input: Signup) {
      init();
      const token = randomBytes(32).toString("hex");
      const result = db.prepare(`INSERT INTO launch_waitlist
        (email, first_name, device, source, medium, campaign, content,
         created_at, consent_version, unsubscribe_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO NOTHING`).run(
        input.email, input.firstName, input.device, input.source, input.medium,
        input.campaign, input.content, new Date().toISOString(), CONSENT_VERSION, digest(token),
      );
      // Duplicate requests never change metadata, resend email or undo an opt-out.
      return result.changes ? { id: Number(result.lastInsertRowid), token } : null;
    },
    setEmailStatus(id: number, status: Contact["emailStatus"]) {
      init();
      db.prepare("UPDATE launch_waitlist SET email_status = ? WHERE id = ?").run(status, id);
    },
    unsubscribe(token: string) {
      init();
      db.prepare(`UPDATE launch_waitlist SET status = 'unsubscribed',
        unsubscribed_at = COALESCE(unsubscribed_at, ?)
        WHERE unsubscribe_hash = ?`).run(new Date().toISOString(), digest(token));
    },
    list(offset = 0) {
      init();
      const rows = db.prepare(`SELECT ${columns} FROM launch_waitlist
        ORDER BY id DESC LIMIT 50 OFFSET ?`).all(offset) as Contact[];
      const summary = db.prepare(`SELECT COUNT(*) AS total,
        COALESCE(SUM(status = 'subscribed'), 0) AS subscribed,
        COALESCE(SUM(status = 'unsubscribed'), 0) AS unsubscribed,
        COALESCE(SUM(email_status = 'failed'), 0) AS emailFailed
        FROM launch_waitlist`).get();
      return { rows, summary };
    },
    exportActive() {
      init();
      return db.prepare(`SELECT ${columns} FROM launch_waitlist
        WHERE status = 'subscribed' ORDER BY id`).all() as Contact[];
    },
  };
}

// Spreadsheet formula injection protection, including leading whitespace.
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportCsv(rows: Contact[]) {
  const fields: (keyof Contact)[] = [
    "email", "firstName", "device", "createdAt", "source", "medium",
    "campaign", "content", "consentVersion", "status", "emailStatus",
  ];
  return "\uFEFF" + [fields.map(csvCell).join(","),
    ...rows.map(row => fields.map(field => csvCell(row[field])).join(","))].join("\r\n");
}
