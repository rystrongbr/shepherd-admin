import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";

// Temporary, explicitly enabled observation of ONE existing reviewer identity.
// No raw payloads, credentials, emails, user IDs, or transaction IDs are logged.
const TARGET = "apple-review+free@myshepherdapp.church";
const startedAt = Date.now();
const fingerprintKey = randomBytes(32);
const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 200;
let observedRequests = 0;
const products = new Set([
  "church.myshepherdapp.plus.monthly",
  "church.myshepherdapp.plus.yearly",
  "church.myshepherdapp.enterprise.monthly",
  "church.myshepherdapp.enterprise.yearly",
]);
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj =>
  value !== null && typeof value === "object" ? value as Obj : {};
const product = (value: unknown) =>
  typeof value === "string" && products.has(value) ? value : "unknown";
const tier = (value: unknown) =>
  value === "free" || value === "plus" || value === "enterprise" ? value : "unknown";
function flag(value: unknown): boolean | null {
  if (value === true || value === "true" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  return null;
}
function milliseconds(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 4_102_444_800_000 ? number : null;
}
const iso = (value: unknown) => {
  const ms = milliseconds(value);
  return ms === null ? null : new Date(ms).toISOString();
};
const fingerprint = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 256
    ? createHmac("sha256", fingerprintKey).update(value).digest("hex").slice(0, 16)
    : null;

/** Fixed allowlisted output only; never spread an Apple response into a log. */
export function summarizeAppleResponse(value: unknown) {
  const response = object(value);
  const receipt = object(response.receipt);
  const transactions = response.latest_receipt_info ?? receipt.in_app;
  const entries = Array.isArray(transactions) ? transactions.map(object) : [];
  // Match the existing verifier's selection, without changing its decision.
  const selected = entries.slice().sort((a, b) =>
    Number(b.expires_date_ms ?? 0) - Number(a.expires_date_ms ?? 0))[0] ?? {};
  const pending = Array.isArray(response.pending_renewal_info)
    ? response.pending_renewal_info.map(object) : [];
  const renewal = pending.find(row =>
    (typeof selected.original_transaction_id === "string" &&
      row.original_transaction_id === selected.original_transaction_id) ||
    (typeof selected.product_id === "string" && row.product_id === selected.product_id));
  const expiry = milliseconds(selected.expires_date_ms);
  const intent = Number(renewal?.expiration_intent);
  return {
    appleStatus: typeof response.status === "number" && Number.isInteger(response.status)
      ? response.status : null,
    environment: response.environment === "Sandbox" || response.environment === "Production"
      ? response.environment : "unknown",
    bundleId: receipt.bundle_id === "church.myshepherdapp" ? "church.myshepherdapp"
      : receipt.bundle_id === undefined ? "missing" : "other",
    transactionCount: entries.length,
    productId: product(selected.product_id),
    transactionFingerprint: fingerprint(selected.transaction_id),
    originalTransactionFingerprint: fingerprint(selected.original_transaction_id),
    purchaseAt: iso(selected.purchase_date_ms),
    expiresAt: iso(selected.expires_date_ms),
    expiryInPast: expiry === null ? null : expiry <= Date.now(),
    cancellationFieldPresent: selected.cancellation_date !== undefined ||
      selected.cancellation_date_ms !== undefined,
    cancellationAt: iso(selected.cancellation_date_ms),
    isUpgraded: flag(selected.is_upgraded),
    isTrial: flag(selected.is_trial_period),
    renewalEntryPresent: Boolean(renewal),
    autoRenewEnabled: flag(renewal?.auto_renew_status),
    autoRenewProductId: renewal ? product(renewal.auto_renew_product_id) : null,
    billingRetry: flag(renewal?.is_in_billing_retry_period),
    expirationIntent: renewal?.expiration_intent !== undefined &&
      Number.isInteger(intent) && intent >= 1 && intent <= 5 ? intent : null,
    gracePeriodExpiresAt: iso(renewal?.grace_period_expires_date_ms),
  };
}

export type ReceiptDiagnostic = ReturnType<typeof summarizeAppleResponse>;

export function beginIapDiagnostic(
  req: Request,
  res: Response,
  operation: "verify-receipt" | "entitlement",
) {
  if (process.env.IAP_REVIEW_DIAGNOSTICS !== "true" ||
      req.user?.email.toLowerCase() !== TARGET ||
      Date.now() - startedAt >= WINDOW_MS || observedRequests >= MAX_REQUESTS) return;
  observedRequests++;
  const requestStartedAt = Date.now();
  const requestId = randomUUID();
  let apple: ReceiptDiagnostic | undefined;
  let decision: { tier: string; productId: string; expiresAt: string | null } | undefined;
  let storedTier: string | undefined;
  let storedOriginalTransactionFingerprint: string | null | undefined;
  const conditionalRequest = {
    ifNoneMatchPresent: Boolean(req.header("if-none-match")),
    ifModifiedSincePresent: Boolean(req.header("if-modified-since")),
  };
  res.once("finish", () => {
    // Diagnostics must never turn a completed purchase into an error.
    try {
      const policy = String(res.getHeader("cache-control") ?? "");
      console.info("[iap-review-diagnostic]", JSON.stringify({
        schemaVersion: 1,
        requestId,
        serverTime: new Date().toISOString(),
        operation,
        httpStatus: res.statusCode,
        durationMs: Date.now() - requestStartedAt,
        ...conditionalRequest,
        etagPresent: Boolean(res.getHeader("etag")),
        cachePolicy: policy.includes("no-store") ? "no-store"
          : policy.includes("no-cache") ? "no-cache" : policy ? "other" : "absent",
        apple,
        decision,
        storedTier,
        storedOriginalTransactionFingerprint,
      }));
    } catch { /* Observation only. */ }
  });
  return {
    observeApple(value: ReceiptDiagnostic) { apple = value; },
    recordDecision(value: { tier: unknown; productId: unknown; expiresAt: unknown }) {
      decision = {
        tier: tier(value.tier),
        productId: product(value.productId),
        expiresAt: typeof value.expiresAt === "string" ? iso(Date.parse(value.expiresAt)) : null,
      };
    },
    recordStored(value: { tier: unknown; originalTransactionId: unknown }) {
      storedTier = tier(value.tier);
      storedOriginalTransactionFingerprint = fingerprint(value.originalTransactionId);
    },
  };
}
