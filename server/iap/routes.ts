/**
 * IAP (In-App Purchase) route handlers.
 *
 * Mounted from server/routes.ts as /api/v1/iap/*. All routes here require
 * an authenticated user (via requireUser) — anonymous devices can't own
 * a subscription because tier is stored per app_user.
 */

import type { Express } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../storage";
import { requireUser, issueUserTokens } from "../auth";
import {
  verifyAppleReceipt,
  productIdToTier,
  ReceiptVerificationError,
} from "./apple-verify";

// The request body from the mobile client — just the base64 receipt string
// pulled off StoreKit. We never trust anything else the client sends about
// the purchase; the receipt (verified with Apple) is the source of truth.
const verifyRequestSchema = z.object({
  receiptData: z.string().min(10, "receiptData must be a non-empty base64 string"),
});

export function registerIapRoutes(app: Express) {
  /**
   * POST /api/v1/iap/verify-receipt
   *
   * Verifies an Apple receipt with the App Store and, on success, updates
   * the authenticated user's tier and subscription expiration. Returns a
   * fresh JWT so the client sees the new tier without a re-login.
   *
   * Idempotent: replaying the same receipt updates the same row with the
   * same values, which is what we want if the mobile client retries after
   * a flaky network.
   */
  // Registered at /api/iap/* — the /api/v1 shim in server/index.ts rewrites
  // /api/v1/iap/verify-receipt → /api/iap/verify-receipt so mobile clients
  // still call the v1 URL. Same pattern as /api/user/me.
  app.post("/api/iap/verify-receipt", requireUser, async (req, res) => {
    const parsed = verifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }

    let verified;
    try {
      verified = await verifyAppleReceipt(parsed.data.receiptData);
    } catch (err) {
      if (err instanceof ReceiptVerificationError) {
        // 402 lets the mobile client distinguish "your receipt didn't verify"
        // (retry / show error) from a generic 500. We log Apple's status
        // code so we can debug 21002 (malformed receipt) etc. server-side.
        console.error("[iap] receipt verification failed", {
          userId: req.user!.id,
          appleStatus: err.appleStatus,
          message: err.message,
        });
        return res.status(402).json({ error: err.message, appleStatus: err.appleStatus });
      }
      throw err;
    }

    const tier = productIdToTier(verified.productId);
    if (!tier) {
      // Defensive — a product ID we don't recognize means the App Store
      // catalog and this server are out of sync. Log loudly, refuse the
      // grant, and surface a clear error to the client.
      console.error("[iap] unknown product_id", {
        userId: req.user!.id,
        productId: verified.productId,
      });
      return res.status(422).json({ error: `Unknown product_id: ${verified.productId}` });
    }

    const expiresAt = new Date(verified.expiresDateMs).toISOString();
    const now = new Date().toISOString();

    // Persist the entitlement. We store expires_at + product_id + original
    // transaction id so that renewal notifications (v1.1) can look up the
    // user by original_transaction_id and refresh their expiration.
    db.run(sql`
      UPDATE app_users
      SET
        tier = ${tier},
        subscription_product_id = ${verified.productId},
        subscription_original_txn_id = ${verified.originalTransactionId},
        subscription_expires_at = ${expiresAt},
        subscription_updated_at = ${now}
      WHERE id = ${req.user!.id}
    `);

    // Issue a fresh JWT with the new tier so the mobile client's
    // in-memory user immediately reflects the entitlement without a
    // round-trip through /api/user/refresh.
    const tokens = issueUserTokens(res, {
      id: req.user!.id,
      email: req.user!.email,
      tier,
    });

    return res.json({
      ok: true,
      tier,
      productId: verified.productId,
      expiresAt,
      environment: verified.environment,
      ...tokens,
    });
  });

  /**
   * GET /api/v1/iap/entitlement
   *
   * Cheap read-only check the mobile client hits at app cold-start to
   * confirm the local JWT's tier matches what the server has recorded.
   * Also returns expires_at so the client can show an appropriate UI when
   * a subscription is expiring soon.
   */
  app.get("/api/iap/entitlement", requireUser, (req, res) => {
    const row = db.get<{
      tier: string;
      subscription_product_id: string | null;
      subscription_expires_at: string | null;
    }>(sql`
      SELECT tier, subscription_product_id, subscription_expires_at
      FROM app_users
      WHERE id = ${req.user!.id}
    `);
    if (!row) return res.status(404).json({ error: "User not found" });

    // If the subscription has expired, downgrade to free on read. This is
    // a lightweight belt-and-suspenders check for the case where our
    // renewal-notification handler (v1.1) hasn't caught up yet. A cron
    // will do the same sweep in bulk once per day.
    let currentTier = row.tier;
    if (
      (row.tier === "plus" || row.tier === "enterprise") &&
      row.subscription_expires_at &&
      new Date(row.subscription_expires_at).getTime() < Date.now()
    ) {
      db.run(sql`
        UPDATE app_users
        SET tier = 'free', subscription_updated_at = ${new Date().toISOString()}
        WHERE id = ${req.user!.id}
      `);
      currentTier = "free";
    }

    return res.json({
      tier: currentTier,
      productId: row.subscription_product_id ?? null,
      expiresAt: row.subscription_expires_at ?? null,
    });
  });
}
