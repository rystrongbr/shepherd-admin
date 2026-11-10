import type Database from "better-sqlite3";
import type { VerifiedGoogleSubscription } from "./google-play";
import { keepsOtherActiveAccess, SubscriptionOwnershipError } from "./ownership";
import { effectiveTier } from "./effective-tier";

export class GoogleAccountMismatchError extends Error {
  readonly code = "GOOGLE_ACCOUNT_MISMATCH";
  constructor() {
    super("This Google Play purchase was made while signed in to a different My Shepherd account. Sign in to that account or contact support.");
  }
}

const GOOGLE_ENVIRONMENTS = ["google-play", "google-play-test"] as const;

type Row = {
  tier: string;
  subscription_product_id: string | null;
  subscription_expires_at: string | null;
  subscription_original_txn_id: string | null;
  subscription_platform: string | null;
};

/** Owner of a Play purchase token, if any (either environment). */
export function googleTokenOwner(sqlite: Database.Database, purchaseToken: string): number | undefined {
  const row = sqlite.prepare(
    "SELECT user_id FROM iap_transaction_owners WHERE environment IN (?, ?) AND original_transaction_id = ? LIMIT 1",
  ).get(...GOOGLE_ENVIRONMENTS, purchaseToken) as { user_id: number } | undefined;
  return row?.user_id;
}

/**
 * Reserve the Play purchase token and persist the entitlement atomically.
 * Mirrors the Apple rule: never silently transfer a purchase between accounts.
 *
 * expectedAccountId is the obfuscatedAccountId this user's app sends to Play
 * Billing. A token carrying a different value is rejected. A token with no
 * value is accepted only if this user already owns it (e.g. RTDN refresh).
 */
export function persistGoogleSubscription(
  sqlite: Database.Database,
  userId: number,
  sub: VerifiedGoogleSubscription,
  expectedAccountId: string,
  now = Date.now(),
) {
  return sqlite.transaction(() => {
    const user = sqlite.prepare(`SELECT tier, subscription_product_id, subscription_expires_at,
      subscription_original_txn_id, subscription_platform FROM app_users WHERE id = ?`)
      .get(userId) as Row | undefined;
    if (!user) throw new SubscriptionOwnershipError("NO_LINKED_SUBSCRIPTION");

    const owner = googleTokenOwner(sqlite, sub.purchaseToken);
    if (sub.obfuscatedAccountId !== null && sub.obfuscatedAccountId !== expectedAccountId) {
      throw new GoogleAccountMismatchError();
    }
    if (sub.obfuscatedAccountId === null && owner !== userId) throw new GoogleAccountMismatchError();

    const conflicting = sqlite.prepare(
      "SELECT id FROM app_users WHERE subscription_original_txn_id = ? AND id != ? LIMIT 1",
    ).get(sub.purchaseToken, userId);
    if (conflicting || (owner !== undefined && owner !== userId)) {
      throw new SubscriptionOwnershipError("PURCHASE_ACCOUNT_CONFLICT");
    }
    // Upgrades/downgrades issue a new token linked to the old one. The old
    // token's owner must be this user; this blocks re-linking someone else's plan.
    if (sub.linkedPurchaseToken) {
      const linkedOwner = googleTokenOwner(sqlite, sub.linkedPurchaseToken);
      if (linkedOwner !== undefined && linkedOwner !== userId) {
        throw new SubscriptionOwnershipError("PURCHASE_ACCOUNT_CONFLICT");
      }
    }

    sqlite.prepare(`INSERT OR IGNORE INTO iap_transaction_owners
      (environment, original_transaction_id, user_id) VALUES (?, ?, ?)`)
      .run(sub.environment, sub.purchaseToken, userId);

    // A stale/expired token (e.g. the plan replaced by an upgrade, or an Apple
    // plan still running) must not erase access another subscription provides.
    if (keepsOtherActiveAccess(user, sub.purchaseToken, sub.entitlementTier, now)) {
      return {
        tier: effectiveTier(user, now),
        productId: user.subscription_product_id ?? sub.productId,
        expiresAt: user.subscription_expires_at ?? new Date(sub.accessExpiresDateMs).toISOString(),
        updated: false,
      };
    }
    const expiresAt = new Date(sub.accessExpiresDateMs).toISOString();
    sqlite.prepare(`UPDATE app_users SET tier = ?, subscription_product_id = ?,
      subscription_original_txn_id = ?, subscription_expires_at = ?, subscription_updated_at = ?,
      subscription_platform = 'google'
      WHERE id = ?`)
      .run(sub.entitlementTier, sub.productId, sub.purchaseToken, expiresAt, new Date(now).toISOString(), userId);
    return { tier: sub.entitlementTier, productId: sub.productId, expiresAt, updated: true };
  }).immediate();
}
