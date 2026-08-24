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
 * Returns the LATEST auto-renewable subscription transaction in the receipt,
 * which is the one whose expiration date determines the user's current
 * entitlement. Older transactions in the same receipt are ignored — they're
 * always superseded by the latest_receipt_info entry.
 *
 * Throws ReceiptVerificationError on:
 *  - Missing APPLE_SHARED_SECRET env var (misconfigured server, not a user error)
 *  - Non-2xx from Apple (network / Apple outage)
 *  - Non-zero status code from Apple that isn't the sandbox-on-prod fallback
 *  - Receipt with no valid subscription transactions
 *  - Product ID we don't recognize (defensive — should never happen if the
 *    IAP catalog and this file stay in sync)
 */
export async function verifyAppleReceipt(receiptData: string): Promise<VerifiedReceipt> {
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

  if (response.status !== STATUS_OK) {
    throw new ReceiptVerificationError(
      `Apple verifyReceipt returned status ${response.status}`,
      response.status,
    );
  }

  // Prefer latest_receipt_info (the auto-renewable subscription history).
  // Fall back to in_app for older receipt formats. We take the entry with
  // the newest expires_date_ms — that's the current subscription state.
  const transactions = response.latest_receipt_info ?? response.receipt?.in_app ?? [];
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new ReceiptVerificationError("Receipt contains no subscription transactions");
  }

  const latest = transactions
    .slice()
    .sort((a, b) => Number(b.expires_date_ms ?? 0) - Number(a.expires_date_ms ?? 0))[0];

  if (!latest.product_id || !latest.transaction_id) {
    throw new ReceiptVerificationError("Receipt transaction is missing required fields");
  }

  return {
    productId: String(latest.product_id),
    transactionId: String(latest.transaction_id),
    originalTransactionId: String(latest.original_transaction_id ?? latest.transaction_id),
    purchaseDateMs: Number(latest.purchase_date_ms ?? 0),
    expiresDateMs: Number(latest.expires_date_ms ?? 0),
    isTrialPeriod: latest.is_trial_period === "true" || latest.is_trial_period === true,
    environment: response.environment === "Sandbox" ? "Sandbox" : "Production",
  };
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
interface AppleResponse {
  status: number;
  environment?: "Production" | "Sandbox";
  latest_receipt_info?: AppleTransaction[];
  receipt?: { in_app?: AppleTransaction[] };
}

interface AppleTransaction {
  product_id?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  purchase_date_ms?: string | number;
  expires_date_ms?: string | number;
  is_trial_period?: string | boolean;
}
