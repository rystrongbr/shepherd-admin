/**
 * Google Play subscription verification (Play Developer API v3,
 * purchases.subscriptionsv2). Google is the source of truth; the mobile
 * client only supplies the purchase token it received from Play Billing.
 *
 * Credentials: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON holds the service-account
 * key, base64-encoded (raw JSON is also accepted). It is never logged.
 */
import { createHmac } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { productIdToTier, type EntitledTier } from "./apple-verify";

export const GOOGLE_PACKAGE_DEFAULT = "church.myshepherdapp";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

/** Subset of the SubscriptionPurchaseV2 resource that we rely on. */
export interface GoogleSubscriptionV2 {
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  testPurchase?: Record<string, unknown>;
  latestOrderId?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{ productId?: string; expiryTime?: string }>;
}

export type GoogleSubscriptionStatus = "active" | "grace" | "canceled" | "pending" | "on_hold" | "paused" | "expired" | "unknown";

export interface VerifiedGoogleSubscription {
  platform: "google";
  environment: "google-play" | "google-play-test";
  purchaseToken: string;
  productId: string;
  entitlementTier: "free" | EntitledTier;
  accessExpiresDateMs: number;
  subscriptionStatus: GoogleSubscriptionStatus;
  obfuscatedAccountId: string | null;
  linkedPurchaseToken: string | null;
  needsAcknowledgement: boolean;
}

export class GooglePlayVerificationError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryable = false) {
    super(message);
  }
}

export class GooglePlayNotConfiguredError extends Error {
  constructor() { super("Google Play purchases are not configured yet."); }
}

/**
 * Stable, non-reversible per-user value passed to Play Billing as
 * obfuscatedAccountId (max 64 chars). Lets the server reject a purchase
 * token that was bought while signed in to a different My Shepherd account.
 */
export function googleAccountIdFor(userId: number, secret = process.env.JWT_SECRET ?? ""): string {
  if (secret.length < 32) throw new Error("JWT_SECRET must be configured");
  return createHmac("sha256", secret).update(`google-play-account:${userId}`).digest("hex");
}

const STATE_MAP: Record<string, GoogleSubscriptionStatus> = {
  SUBSCRIPTION_STATE_ACTIVE: "active",
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace",
  SUBSCRIPTION_STATE_CANCELED: "canceled",
  SUBSCRIPTION_STATE_PENDING: "pending",
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: "pending",
  SUBSCRIPTION_STATE_ON_HOLD: "on_hold",
  SUBSCRIPTION_STATE_PAUSED: "paused",
  SUBSCRIPTION_STATE_EXPIRED: "expired",
};
// Canceled = auto-renew off; Google keeps access until expiryTime. Refund with
// revoke moves the token to EXPIRED, which never grants access.
const ACCESS_STATES = new Set<GoogleSubscriptionStatus>(["active", "grace", "canceled"]);

/** Pure decision: never grants access without a known product and a future expiry. */
export function resolveGoogleSubscription(
  purchaseToken: string,
  value: GoogleSubscriptionV2,
  now = Date.now(),
): VerifiedGoogleSubscription {
  const known = (value.lineItems ?? [])
    .map(item => ({ productId: item.productId ?? "", expiry: Date.parse(item.expiryTime ?? "") }))
    .filter(item => productIdToTier(item.productId) && Number.isFinite(item.expiry))
    .sort((a, b) => b.expiry - a.expiry);
  const line = known[0];
  if (!line) throw new GooglePlayVerificationError("This purchase is not a My Shepherd subscription.", 422);
  const status = STATE_MAP[value.subscriptionState ?? ""] ?? "unknown";
  const paid = ACCESS_STATES.has(status) && line.expiry > now;
  return {
    platform: "google",
    environment: value.testPurchase ? "google-play-test" : "google-play",
    purchaseToken,
    productId: line.productId,
    entitlementTier: paid ? productIdToTier(line.productId)! : "free",
    accessExpiresDateMs: line.expiry,
    subscriptionStatus: status,
    obfuscatedAccountId: value.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    linkedPurchaseToken: value.linkedPurchaseToken ?? null,
    needsAcknowledgement: paid && value.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING",
  };
}

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

export interface GooglePlayClient {
  packageName: string;
  getSubscription(purchaseToken: string): Promise<GoogleSubscriptionV2>;
  acknowledge(productId: string, purchaseToken: string): Promise<void>;
}

function readServiceAccount(env: NodeJS.ProcessEnv): ServiceAccount | null {
  const raw = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(text);
    if (typeof parsed?.client_email !== "string" || typeof parsed?.private_key !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Returns null when Google Play is not configured; callers answer 503. */
export function createGooglePlayClient(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): GooglePlayClient | null {
  const account = readServiceAccount(env);
  if (!account) return null;
  const packageName = env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || GOOGLE_PACKAGE_DEFAULT;
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const key = await importPKCS8(account!.private_key, "RS256");
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account!.client_email)
      .setAudience(TOKEN_URL)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!res.ok) throw new GooglePlayVerificationError("Google Play authorization failed.", 502, true);
    const body = await res.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new GooglePlayVerificationError("Google Play authorization failed.", 502, true);
    cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  async function call(url: string, init: RequestInit = {}) {
    const token = await accessToken();
    const res = await fetchImpl(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 404 || res.status === 400 || res.status === 410) {
      throw new GooglePlayVerificationError("Google Play did not recognize this purchase.", 402);
    }
    if (res.status === 401 || res.status === 403) {
      throw new GooglePlayVerificationError("Google Play access is not set up correctly.", 502, true);
    }
    if (!res.ok) throw new GooglePlayVerificationError("Google Play is temporarily unavailable.", 502, true);
    return res;
  }

  const base = `${API}/${encodeURIComponent(packageName)}/purchases`;
  return {
    packageName,
    async getSubscription(purchaseToken) {
      const res = await call(`${base}/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`);
      return await res.json() as GoogleSubscriptionV2;
    },
    async acknowledge(productId, purchaseToken) {
      await call(
        `${base}/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
    },
  };
}
