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
import { db, sqlite } from "../storage";
import { requireUser, issueUserTokens } from "../auth";
import { beginIapDiagnostic } from "./diagnostics";
import { effectiveTier } from "./effective-tier";
import { persistVerifiedSubscription, SubscriptionOwnershipError } from "./ownership";
import {
  verifyAppleReceipt,
  ReceiptVerificationError,
} from "./apple-verify";

// The request body from the mobile client — just the base64 receipt string
// pulled off StoreKit. We never trust anything else the client sends about
// the purchase; the receipt (verified with Apple) is the source of truth.
const verifyRequestSchema = z.object({
  receiptData: z.string().min(10, "receiptData must be a non-empty base64 string"),
  syncOnly: z.boolean().optional().default(false),
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
    res.setHeader("Cache-Control", "private, no-store");
    const diagnostic = beginIapDiagnostic(req, res, "verify-receipt");
    const parsed = verifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }

    let verified;
    try {
      verified = await verifyAppleReceipt(parsed.data.receiptData, diagnostic?.observeApple);
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

    let entitlement;
    try {
      entitlement = persistVerifiedSubscription(sqlite, req.user!.id, verified, parsed.data.syncOnly);
    } catch (error) {
      if (error instanceof SubscriptionOwnershipError) {
        return res.status(409).json({ error: error.message, code: error.code });
      }
      throw error;
    }
    const { tier, expiresAt } = entitlement;
    diagnostic?.recordDecision({ tier, productId: verified.productId, expiresAt });

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
      subscriptionStatus: verified.subscriptionStatus,
      ...tokens,
    });
  });

  /**
   * GET /api/v1/iap/entitlement
   *
   * Stored-state check the mobile client hits at app cold-start to
   * confirm the local JWT's tier matches what the server has recorded.
   * Also returns expires_at so the client can show an appropriate UI when
   * a subscription is expiring soon.
   */
  app.get("/api/iap/entitlement", requireUser, (req, res) => {
    const diagnostic = beginIapDiagnostic(req, res, "entitlement");
    res.setHeader("Cache-Control", "private, no-store");
    // This account-specific lifecycle response always carries a fresh body,
    // including for older mobile builds sending conditional cache headers.
    delete req.headers["if-none-match"];
    delete req.headers["if-modified-since"];
    const row = db.get<{
      tier: string;
      subscription_product_id: string | null;
      subscription_expires_at: string | null;
      subscription_original_txn_id: string | null;
    }>(sql`
      SELECT tier, subscription_product_id, subscription_expires_at, subscription_original_txn_id
      FROM app_users
      WHERE id = ${req.user!.id}
    `);
    if (!row) return res.status(404).json({ error: "User not found" });
    diagnostic?.recordStored({ tier: row.tier, originalTransactionId: row.subscription_original_txn_id });

    // Never extend stored access without renewed Apple evidence. Build 10
    // reconciles an already-owned receipt on launch/foreground and renewal
    // events. This route itself does not contact Apple.
    const currentTier = effectiveTier(row);
    if (currentTier !== row.tier) {
      db.run(sql`
        UPDATE app_users
        SET tier = 'free', subscription_updated_at = ${new Date().toISOString()}
        WHERE id = ${req.user!.id}
      `);
    }

    diagnostic?.recordDecision({
      tier: currentTier,
      productId: row.subscription_product_id,
      expiresAt: row.subscription_expires_at,
    });
    return res.json({
      tier: currentTier,
      productId: row.subscription_product_id ?? null,
      expiresAt: row.subscription_expires_at ?? null,
      hasVerifiedSubscription: Boolean(row.subscription_original_txn_id),
    });
  });
}
