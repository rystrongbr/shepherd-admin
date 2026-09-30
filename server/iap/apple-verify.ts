/**
 * Apple StoreKit receipt verification.
 *
 * Verifies a base64-encoded App Store receipt with Apple's verifyReceipt
 * endpoint. Handles the required sandbox fallback: production Apple servers
 * return status 21007 for a sandbox receipt, and we retry against the sandbox
 * URL when that happens. This is the pattern Apple explicitly documents for
 * production apps so that TestFlight + App Store reviewer purchases work with
 * the same code path as production purchases.
 *
 * https://developer.apple.com/documentation/appstorereceipts/verifyreceipt
 */

import { summarizeAppleResponse, type ReceiptDiagnostic } from "./diagnostics";

const APPLE_PROD_URL = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";

// Apple's status codes we care about. Full list at the URL above.
const STATUS_OK = 0;
const STATUS_SANDBOX_RECEIPT_ON_PROD = 21007;

// Our four in-app purchase product identifiers, registered in App Store Connect.
// Product IDs are the source of truth for what tier the user is entitled to —
// we never trust a client-provided tier string.
export const PRODUCT_ID_PLUS_MONTHLY = "church.myshepherdapp.plus.monthly";
export const PRODUCT_ID_PLUS_YEARLY = "church.myshepherdapp.plus.yearly";
export const PRODUCT_ID_ENTERPRISE_MONTHLY = "church.myshepherdapp.enterprise.monthly";
export const PRODUCT_ID_ENTERPRISE_YEARLY = "church.myshepherdapp.enterprise.yearly";

export type EntitledTier = "plus" | "enterprise";

/** Maps an Apple product ID to the entitlement tier we grant. */
export function productIdToTier(productId: string): EntitledTier | null {
  switch (productId) {
    case PRODUCT_ID_PLUS_MONTHLY:
    case PRODUCT_ID_PLUS_YEARLY:
      return "plus";
    case PRODUCT_ID_ENTERPRISE_MONTHLY:
    case PRODUCT_ID_ENTERPRISE_YEARLY:
      return "enterprise";
    default:
      return null;
  }
}

/**
 * The subset of Apple's response we consume. Apple's real response has many
 * more fields; we only pick the ones our entitlement logic needs.
 */
export interface VerifiedReceipt {
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  purchaseDateMs: number;
  expiresDateMs: number;
  isTrialPeriod: boolean;
  environment: "Production" | "Sandbox";
  entitlementTier: "free" | EntitledTier;
  subscriptionStatus: "active" | "grace" | "expired" | "revoked" | "upgraded";
  accessExpiresDateMs: number;
}

export class ReceiptVerificationError extends Error {
  constructor(message: string, public readonly appleStatus?: number) {
    super(message);
    this.name = "ReceiptVerificationError";
  }
}

/**
 * Verify a base64-encoded receipt with Apple.
 *
 * Resolves the currently valid subscription, or real historical transaction
 * when none grants access. Expiration, refunds, upgrades and grace periods
 * are evaluated separately from Apple's receipt authenticity status.
 *
 * Throws ReceiptVerificationError on:
 *  - Missing APPLE_SHARED_SECRET env var (misconfigured server, not a user error)
 *  - Non-2xx from Apple (network / Apple outage)
 *  - Non-zero status code from Apple that isn't the sandbox-on-prod fallback
 *  - Receipt with no valid subscription transactions
 *  - Product ID we don't recognize (defensive — should never happen if the
 *    IAP catalog and this file stay in sync)
 */
export async function verifyAppleReceipt(
  receiptData: string,
  onDiagnostic?: (summary: ReceiptDiagnostic) => void,
): Promise<VerifiedReceipt> {
  const sharedSecret = process.env.APPLE_SHARED_SECRET;
  if (!sharedSecret) {
    throw new ReceiptVerificationError(
      "APPLE_SHARED_SECRET is not configured on the server",
    );
  }

  const body = {
    "receipt-data": receiptData,
    password: sharedSecret,
    // Excludes old transactions from the response payload we don't need.
    "exclude-old-transactions": true,
  };

  // First try production. Apple's guidance is always-prod-first with
  // sandbox as an explicit fallback, so that TestFlight receipts and App
  // Store reviewer receipts both work without shipping a separate build.
  let response = await postToApple(APPLE_PROD_URL, body);

  if (response.status === STATUS_SANDBOX_RECEIPT_ON_PROD) {
    response = await postToApple(APPLE_SANDBOX_URL, body);
  }

  if (onDiagnostic) {
    try { onDiagnostic(summarizeAppleResponse(response)); }
    catch { /* Diagnostics cannot change verification behavior. */ }
  }

  if (response.status !== STATUS_OK) {
    throw new ReceiptVerificationError(
      `Apple verifyReceipt returned status ${response.status}`,
      response.status,
    );
  }

  return resolveAppleReceipt(response);
}

/** Receipt authenticity and current paid access are different decisions. */
export function resolveAppleReceipt(response: AppleResponse, now = Date.now()): VerifiedReceipt {
  if (response.status !== STATUS_OK) throw new ReceiptVerificationError("Receipt status is not valid", response.status);
  if (response.receipt?.bundle_id !== "church.myshepherdapp") {
    throw new ReceiptVerificationError("Receipt does not belong to this app");
  }
  if (response.environment !== "Sandbox" && response.environment !== "Production") {
    throw new ReceiptVerificationError("Receipt environment is missing or invalid");
  }
  const transactions = response.latest_receipt_info ?? response.receipt?.in_app ?? [];
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new ReceiptVerificationError("Receipt contains no subscription transactions");
  }

  const candidates: VerifiedReceipt[] = [];
  for (const entry of transactions) {
    const paidTier = typeof entry.product_id === "string" ? productIdToTier(entry.product_id) : null;
    if (!paidTier) continue;
    const identifier = (value: unknown): value is string =>
      typeof value === "string" && value.length > 0 && value.length <= 256;
    const date = (value: unknown): number => {
      const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
      if (!Number.isFinite(n) || n <= 0 || n >= 4_102_444_800_000) {
        throw new ReceiptVerificationError("Receipt transaction has an invalid date");
      }
      return n;
    };
    if (!identifier(entry.transaction_id) || !identifier(entry.original_transaction_id)) {
      throw new ReceiptVerificationError("Receipt transaction is missing required identifiers");
    }
    const purchaseDateMs = date(entry.purchase_date_ms);
    const expiresDateMs = date(entry.expires_date_ms);
    if (purchaseDateMs > now + 300_000 || expiresDateMs < purchaseDateMs) {
      throw new ReceiptVerificationError("Receipt transaction dates are inconsistent");
    }
    const revoked = entry.cancellation_date !== undefined || entry.cancellation_date_ms !== undefined;
    const upgraded = entry.is_upgraded === "true" || entry.is_upgraded === true;
    const renewal = response.pending_renewal_info?.find(row =>
      row.original_transaction_id === entry.original_transaction_id &&
      row.product_id === entry.product_id);
    const grace = renewal?.grace_period_expires_date_ms === undefined
      ? null : date(renewal.grace_period_expires_date_ms);
    const inGrace = !revoked && !upgraded && expiresDateMs <= now &&
      grace !== null && grace > now;
    const active = !revoked && !upgraded && (expiresDateMs > now || inGrace);
    candidates.push({
      productId: entry.product_id!,
      transactionId: entry.transaction_id,
      originalTransactionId: entry.original_transaction_id,
      purchaseDateMs, expiresDateMs,
      isTrialPeriod: entry.is_trial_period === "true" || entry.is_trial_period === true,
      environment: response.environment,
      entitlementTier: active ? paidTier : "free",
      subscriptionStatus: revoked ? "revoked" : upgraded ? "upgraded"
        : inGrace ? "grace" : active ? "active" : "expired",
      accessExpiresDateMs: inGrace ? grace! : expiresDateMs,
    });
  }
  if (!candidates.length) throw new ReceiptVerificationError("Receipt contains no recognized subscription transactions");
  // Never allow an old refunded/upgraded annual transaction to eclipse a
  // currently valid subscription. Without active access, retain real history.
  const active = candidates.filter(entry => entry.entitlementTier !== "free");
  return (active.length ? active : candidates)
    .sort((a, b) => b.purchaseDateMs - a.purchaseDateMs || b.expiresDateMs - a.expiresDateMs)[0];
}

/**
 * Internal helper — one HTTP round-trip to Apple. Kept separate so the retry
 * loop in verifyAppleReceipt is readable and each call site has consistent
 * error handling.
 */
async function postToApple(url: string, body: unknown): Promise<AppleResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new ReceiptVerificationError(
      `Apple verifyReceipt HTTP ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as AppleResponse;
}

// Shape of the JSON Apple returns. Typed loosely because their field set
// evolves over time and we only pull the pieces we know about.
export interface AppleResponse {
  status: number;
  environment?: "Production" | "Sandbox";
  latest_receipt_info?: AppleTransaction[];
  receipt?: { bundle_id?: string; in_app?: AppleTransaction[] };
  pending_renewal_info?: {
    original_transaction_id?: string;
    product_id?: string;
    grace_period_expires_date_ms?: string | number;
    auto_renew_status?: string;
  }[];
}

interface AppleTransaction {
  product_id?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  purchase_date_ms?: string | number;
  expires_date_ms?: string | number;
  is_trial_period?: string | boolean;
  cancellation_date?: string;
  cancellation_date_ms?: string | number;
  is_upgraded?: string | boolean;
}
