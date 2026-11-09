import type Database from "better-sqlite3";
import type { VerifiedReceipt } from "./apple-verify";
import { effectiveTier } from "./effective-tier";

export class SubscriptionOwnershipError extends Error {
  constructor(public readonly code: "NO_LINKED_SUBSCRIPTION" | "PURCHASE_ACCOUNT_CONFLICT") {
    super(code === "NO_LINKED_SUBSCRIPTION"
      ? "No existing purchase is linked to this My Shepherd account."
      : "This purchase is linked to another My Shepherd account. Sign in to that account or contact support.");
  }
}

type CurrentRow = {
  tier: string;
  subscription_product_id: string | null;
  subscription_expires_at: string | null;
  subscription_original_txn_id: string | null;
  subscription_platform: string | null;
};

/**
 * Cross-store guard: a store result that grants nothing must not erase paid
 * access that a *different*, still-valid subscription already provides.
 */
export function keepsOtherActiveAccess(row: CurrentRow, incomingId: string, incomingTier: string, now = Date.now()) {
  return incomingTier === "free" &&
    row.subscription_original_txn_id !== null &&
    row.subscription_original_txn_id !== incomingId &&
    effectiveTier(row, now) !== "free";
}

/** Reserve and persist atomically; never silently transfer an Apple purchase. */
export function persistVerifiedSubscription(
  sqlite: Database.Database,
  userId: number,
  receipt: VerifiedReceipt,
  syncOnly: boolean,
) {
  return sqlite.transaction(() => {
    const user = sqlite.prepare(`SELECT tier, subscription_product_id, subscription_expires_at,
      subscription_original_txn_id, subscription_platform FROM app_users WHERE id = ?`)
      .get(userId) as CurrentRow | undefined;
    if (!user) throw new SubscriptionOwnershipError("NO_LINKED_SUBSCRIPTION");
    const owner = sqlite.prepare(
      "SELECT user_id FROM iap_transaction_owners WHERE environment = ? AND original_transaction_id = ?",
    ).get(receipt.environment, receipt.originalTransactionId) as { user_id: number } | undefined;
    // Existing installs predate the registry. Detect conflicting legacy rows
    // before claiming; do not arbitrarily pick an owner or reset their access.
    const conflicting = sqlite.prepare(
      "SELECT id FROM app_users WHERE subscription_original_txn_id = ? AND id != ? LIMIT 1",
    ).get(receipt.originalTransactionId, userId);
    if (conflicting || (owner && owner.user_id !== userId)) {
      throw new SubscriptionOwnershipError("PURCHASE_ACCOUNT_CONFLICT");
    }
    if (syncOnly && user.subscription_original_txn_id !== receipt.originalTransactionId) {
      throw new SubscriptionOwnershipError("NO_LINKED_SUBSCRIPTION");
    }
    sqlite.prepare(`INSERT OR IGNORE INTO iap_transaction_owners
      (environment, original_transaction_id, user_id) VALUES (?, ?, ?)`)
      .run(receipt.environment, receipt.originalTransactionId, userId);
    // Apple behavior is unchanged except for one case: an expired/free Apple
    // receipt never overwrites an active Google Play subscription.
    if (user.subscription_platform === "google" &&
        keepsOtherActiveAccess(user, receipt.originalTransactionId, receipt.entitlementTier)) {
      return {
        tier: effectiveTier(user) as typeof receipt.entitlementTier,
        productId: user.subscription_product_id ?? receipt.productId,
        expiresAt: user.subscription_expires_at ?? new Date(receipt.accessExpiresDateMs).toISOString(),
      };
    }
    const expiresAt = new Date(receipt.accessExpiresDateMs).toISOString();
    sqlite.prepare(`UPDATE app_users SET tier = ?, subscription_product_id = ?,
      subscription_original_txn_id = ?, subscription_expires_at = ?, subscription_updated_at = ?,
      subscription_platform = 'apple'
      WHERE id = ?`)
      .run(receipt.entitlementTier, receipt.productId, receipt.originalTransactionId,
        expiresAt, new Date().toISOString(), userId);
    return { tier: receipt.entitlementTier, productId: receipt.productId, expiresAt };
  }).immediate();
}
