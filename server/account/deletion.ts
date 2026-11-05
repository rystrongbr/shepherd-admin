import type { Express, Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { REVIEWER_ACCOUNTS } from "../reviewer-signin";

/**
 * In-app account deletion (Apple 5.1.1(v), Google Play account-deletion policy).
 *
 * DELETE /api/user/me (mobile: /api/v1/user/me) with body { "confirm": "DELETE" }.
 *
 * What happens, in one SQLite transaction:
 *   - Deleted: the app_users row, chats, chat reactions, donation prompts,
 *     daily question counts, refresh tokens, IAP ownership links, member
 *     signups and affiliations for the email, and launch-waitlist entries.
 *   - Anonymized (kept for accounting/safety statistics, no longer linked to the
 *     person): donations (user_id and email cleared) and crisis safety signals
 *     (user_id cleared).
 *   - Not touched: anonymous `insights` rows (no user link), and church CRM
 *     tables (`members`, `email_events`), which belong to churches.
 *
 * App Store / Google Play subscriptions are billed by Apple / Google, not us;
 * deleting the account does not cancel them. The client tells the user this
 * before they confirm.
 *
 * Reviewer demo accounts (REVIEWER_ACCOUNTS) are protected: their history is
 * cleared and tokens revoked so the flow behaves the same for App Review, but
 * the account row and its subscription state are kept so the demo accounts
 * keep working for later reviews.
 */

export const DELETE_CONFIRMATION = "DELETE";

export type DeletionResult = { deleted: true; demoAccountPreserved: boolean };

const REVIEWER_EMAILS = new Set(Object.keys(REVIEWER_ACCOUNTS).map(e => e.toLowerCase()));
export const isProtectedReviewerEmail = (email: string) => REVIEWER_EMAILS.has(email.trim().toLowerCase());

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

export function deleteAppUserAccount(db: Database.Database, userId: number, email: string): DeletionResult {
  const mail = email.trim().toLowerCase();
  const preserve = isProtectedReviewerEmail(mail);
  const has = (t: string) => tableExists(db, t);
  const run = (t: string, sqlText: string, ...params: unknown[]) => {
    if (has(t)) db.prepare(sqlText).run(...params);
  };

  db.transaction(() => {
    // Conversation history.
    if (has("chat_reactions")) {
      db.prepare(
        "DELETE FROM chat_reactions WHERE user_id = ? OR chat_id IN (SELECT id FROM chats WHERE user_id = ?)",
      ).run(userId, userId);
    }
    run("chats", "DELETE FROM chats WHERE user_id = ?", userId);
    run("daily_question_counts", "DELETE FROM daily_question_counts WHERE user_id = ?", userId);

    // Sessions: revoke every refresh token so other devices are signed out.
    run("auth_refresh_tokens", "DELETE FROM auth_refresh_tokens WHERE subject_type = 'user' AND subject_id = ?", userId);

    if (preserve) return;

    // Donations: keep the financial record, drop the link to the person.
    if (has("donation_prompts")) {
      run(
        "donations",
        "UPDATE donations SET prompt_id = NULL WHERE prompt_id IN (SELECT id FROM donation_prompts WHERE user_id = ?)",
        userId,
      );
      db.prepare("DELETE FROM donation_prompts WHERE user_id = ?").run(userId);
    }
    run("donations", "UPDATE donations SET user_id = NULL, email = '' WHERE user_id = ? OR lower(email) = ?", userId, mail);
    run("crisis_safety_signals", "UPDATE crisis_safety_signals SET user_id = NULL WHERE user_id = ?", userId);

    run("member_signups", "DELETE FROM member_signups WHERE user_id = ? OR lower(email) = ?", userId, mail);
    run("affiliations", "DELETE FROM affiliations WHERE lower(email) = ?", mail);
    run("launch_waitlist", "DELETE FROM launch_waitlist WHERE lower(email) = ?", mail);
    run("iap_transaction_owners", "DELETE FROM iap_transaction_owners WHERE user_id = ?", userId);

    db.prepare("DELETE FROM app_users WHERE id = ?").run(userId);
  })();

  return { deleted: true, demoAccountPreserved: preserve };
}

type Deps = {
  db: Database.Database;
  requireUser: (req: Request, res: Response, next: NextFunction) => void;
  log?: (message: string) => void;
};

export function registerAccountDeletion(app: Express, deps: Deps) {
  const log = deps.log ?? (m => console.log(m));
  app.delete("/api/user/me", deps.requireUser, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.body?.confirm !== DELETE_CONFIRMATION) {
      return res.status(400).json({ error: `Send { "confirm": "${DELETE_CONFIRMATION}" } to delete this account.` });
    }
    const { id, email } = req.user!;
    try {
      const result = deleteAppUserAccount(deps.db, id, email);
      // User id only: never log the email address.
      log(`[account] deleted user ${id}${result.demoAccountPreserved ? " (reviewer demo preserved)" : ""}`);
      return res.json(result);
    } catch (err) {
      log(`[account] deletion failed for user ${id}: ${(err as Error).message}`);
      return res.status(500).json({ error: "We couldn't delete your account. Please try again or contact support." });
    }
  });
}
