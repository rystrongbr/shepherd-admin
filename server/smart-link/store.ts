import type Database from "better-sqlite3";
import type { Platform } from "./detect";

export type SmartLinkClick = { src: string; campaign: string; platform: Platform };

/**
 * Additive, PII-free click log for the smart download link. Stores only the
 * timestamp, the whitelisted src/campaign labels, and the coarse platform
 * bucket. Never stores IP, User-Agent, referrer, cookies or any identifier.
 * Same lazy CREATE TABLE IF NOT EXISTS pattern as launch_waitlist; the
 * Postgres equivalent lives in server/migrations/002_smart_link_clicks.ts.
 */
export function createSmartLinkStore(db: Database.Database) {
  let ready = false;
  let insert: Database.Statement | null = null;
  function init() {
    if (ready) return;
    db.exec(`CREATE TABLE IF NOT EXISTS smart_link_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      src TEXT NOT NULL DEFAULT 'unknown',
      campaign TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT 'other'
    );
    CREATE INDEX IF NOT EXISTS idx_smart_link_clicks_created_at ON smart_link_clicks (created_at);`);
    insert = db.prepare(
      `INSERT INTO smart_link_clicks (created_at, src, campaign, platform) VALUES (?, ?, ?, ?)`,
    );
    ready = true;
  }
  return {
    init,
    record(click: SmartLinkClick) {
      init();
      insert!.run(new Date().toISOString(), click.src, click.campaign, click.platform);
    },
  };
}
