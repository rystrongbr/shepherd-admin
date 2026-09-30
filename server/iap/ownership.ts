import type Database from "better-sqlite3";
import type { VerifiedReceipt } from "./apple-verify";

export class SubscriptionOwnershipError extends Error {
  constructor(public readonly code: "NO_LINKED_SUBSCRIPTION" | "PURCHASE_ACCOUNT_CONFLICT") {
    super(code === "NO_LINKED_SUBSCRIPTION"
      ? "No existing purchase is linked to this My Shepherd account."
      : "This purchase is linked to another My Shepherd account. Sign in to that account or contact support.");
  }
}

/** Reserve and persist atomically; never silently transfer an Apple purchase. */
export function persistVerifiedSubscription(
  sqlite: Database.Database,
  userId: number,
  receipt: VerifiedReceipt,
  syncOnly: boolean,
) {
  return sqlite.transaction(() => {
    const user = sqlite.prepare("SELECT subscription_original_txn_id FROM app_users WHERE id = ?")
      .get(userId) as { subscription_original_txn_id: string | null } | undefined;
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
    const expiresAt = new Date(receipt.accessExpiresDateMs).toISOString();
    sqlite.prepare(`UPDATE app_users SET tier = ?, subscription_product_id = ?,
      subscription_original_txn_id = ?, subscription_expires_at = ?, subscription_updated_at = ?
      WHERE id = ?`)
      .run(receipt.entitlementTier, receipt.productId, receipt.originalTransactionId,
        expiresAt, new Date().toISOString(), userId);
    return { tier: receipt.entitlementTier, productId: receipt.productId, expiresAt };
  }).immediate();
}
