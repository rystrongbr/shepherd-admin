/**
 * Google Play billing routes.
 *
 *   POST /api/v1/iap/google/verify  (user Bearer token)
 *   POST /api/v1/iap/google/rtdn    (Pub/Sub push, Google-signed OIDC token)
 *
 * The /api/v1 shim strips /v1, and /iap is already on the admin-gate public
 * list; each handler does its own authentication.
 */
import type { Express, Request, RequestHandler, Response } from "express";
import type Database from "better-sqlite3";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { productIdToTier } from "./apple-verify";
import {
  createGooglePlayClient,
  googleAccountIdFor,
  GooglePlayVerificationError,
  resolveGoogleSubscription,
  type GooglePlayClient,
} from "./google-play";
import { GoogleAccountMismatchError, googleTokenOwner, persistGoogleSubscription } from "./google-ownership";
import { SubscriptionOwnershipError } from "./ownership";

type Claims = { id: number; email: string; tier: "free" | "plus" | "enterprise" };
export type GoogleRouteDeps = {
  sqlite: Database.Database;
  requireUser: RequestHandler;
  issueTokens: (res: Response, user: Claims) => object;
  getClient?: () => GooglePlayClient | null;
  verifyPushToken?: (token: string) => Promise<boolean>;
  accountIdFor?: (userId: number) => string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
};

const verifySchema = z.object({
  purchaseToken: z.string().min(10).max(4096),
  productId: z.string().min(1).max(200),
});

const GOOGLE_CERTS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Pub/Sub push authentication: Google-signed ID token for our push service account. */
export function pushTokenVerifier(env: NodeJS.ProcessEnv = process.env) {
  return async (token: string) => {
    const audience = env.GOOGLE_RTDN_AUDIENCE?.trim();
    const email = env.GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL?.trim().toLowerCase();
    if (!audience || !email) return false;
    try {
      const { payload } = await jwtVerify(token, GOOGLE_CERTS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience,
      });
      return payload.email_verified === true &&
        typeof payload.email === "string" && payload.email.toLowerCase() === email;
    } catch {
      return false;
    }
  };
}

// Created lazily so a missing key never stops the server from booting.
let defaultClient: GooglePlayClient | null | undefined;
function lazyClient() {
  if (defaultClient === undefined) defaultClient = createGooglePlayClient();
  return defaultClient;
}

export function registerGoogleIapRoutes(app: Express, deps: GoogleRouteDeps) {
  const env = deps.env ?? process.env;
  const getClient = deps.getClient ?? lazyClient;
  const verifyPushToken = deps.verifyPushToken ?? pushTokenVerifier(env);
  const accountIdFor = deps.accountIdFor ?? ((id: number) => googleAccountIdFor(id));
  const now = deps.now ?? Date.now;

  app.post("/api/iap/google/verify", deps.requireUser, async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    const client = getClient();
    if (!client) return res.status(503).json({ error: "Google Play purchases are not available yet." });
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success || !productIdToTier(parsed.data.productId)) {
      return res.status(400).json({ error: "Invalid purchase." });
    }
    const user = req.user!;
    let sub;
    try {
      sub = resolveGoogleSubscription(parsed.data.purchaseToken,
        await client.getSubscription(parsed.data.purchaseToken), now());
    } catch (error) {
      if (error instanceof GooglePlayVerificationError) {
        console.error("[iap-google] verification failed", { userId: user.id, status: error.status });
        return res.status(error.status).json({ error: error.message });
      }
      throw error;
    }
    if (sub.productId !== parsed.data.productId) {
      // Deferred downgrades keep the old product on the token until renewal.
      // Google's answer wins; note it without logging the token.
      console.warn("[iap-google] product differs from client", { userId: user.id, productId: sub.productId });
    }

    let entitlement;
    try {
      entitlement = persistGoogleSubscription(deps.sqlite, user.id, sub, accountIdFor(user.id), now());
    } catch (error) {
      if (error instanceof GoogleAccountMismatchError || error instanceof SubscriptionOwnershipError) {
        return res.status(409).json({ error: error.message, code: error.code });
      }
      throw error;
    }

    // Persist first, then acknowledge (Google refunds unacknowledged purchases
    // after 3 days). The app's finishTransaction also acknowledges, so a
    // failure here is logged, not fatal.
    if (sub.needsAcknowledgement) {
      try { await client.acknowledge(sub.productId, sub.purchaseToken); }
      catch { console.error("[iap-google] acknowledge failed; client will retry", { userId: user.id }); }
    }

    const tokens = deps.issueTokens(res, { id: user.id, email: user.email, tier: entitlement.tier });
    return res.json({
      ok: true,
      tier: entitlement.tier,
      productId: entitlement.productId,
      expiresAt: entitlement.expiresAt,
      environment: sub.environment,
      subscriptionStatus: sub.subscriptionStatus,
      ...tokens,
    });
  });

  app.post("/api/iap/google/rtdn", async (req: Request, res: Response) => {
    const header = req.headers.authorization ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!bearer || !(await verifyPushToken(bearer))) return res.status(401).end();

    // After authentication, malformed or irrelevant messages are acknowledged
    // (2xx) so Pub/Sub does not retry them for days.
    let message: any;
    try {
      message = JSON.parse(Buffer.from(String(req.body?.message?.data ?? ""), "base64").toString("utf8"));
    } catch {
      return res.status(204).end();
    }
    const client = getClient();
    if (!client) return res.status(503).end();
    if (message?.packageName !== client.packageName) return res.status(204).end();
    if (message.testNotification) {
      console.log("[iap-google] RTDN test notification received");
      return res.status(204).end();
    }
    const purchaseToken: unknown = message.subscriptionNotification?.purchaseToken ??
      message.voidedPurchaseNotification?.purchaseToken;
    if (typeof purchaseToken !== "string" || !purchaseToken) return res.status(204).end();

    // Unknown token: the app has not verified it yet; its own verify call will
    // claim it. We never assign ownership from a notification.
    const owner = googleTokenOwner(deps.sqlite, purchaseToken);
    if (owner === undefined) return res.status(204).end();

    try {
      const sub = resolveGoogleSubscription(purchaseToken, await client.getSubscription(purchaseToken), now());
      persistGoogleSubscription(deps.sqlite, owner, sub, accountIdFor(owner), now());
      if (sub.needsAcknowledgement) await client.acknowledge(sub.productId, sub.purchaseToken).catch(() => {});
      console.log("[iap-google] RTDN applied", {
        userId: owner,
        type: message.subscriptionNotification?.notificationType ?? "voided",
        tier: sub.entitlementTier,
      });
      return res.status(204).end();
    } catch (error) {
      if (error instanceof GooglePlayVerificationError && error.retryable) return res.status(500).end();
      console.error("[iap-google] RTDN not applied", {
        userId: owner,
        reason: error instanceof Error ? error.constructor.name : "unknown",
      });
      return res.status(204).end();
    }
  });
}
