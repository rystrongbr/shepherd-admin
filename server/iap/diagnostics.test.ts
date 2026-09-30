import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beginIapDiagnostic, summarizeAppleResponse } from "./diagnostics";

function request(email = "apple-review+free@myshepherdapp.church") {
  return { user: { email }, header: () => "private-header-value" } as unknown as Request;
}
function response() {
  const res = new EventEmitter() as EventEmitter & { statusCode: number; getHeader: (key: string) => unknown };
  res.statusCode = 304;
  res.getHeader = key => key === "etag" ? "private-etag-value" : undefined;
  return res as unknown as Response;
}

test("Apple summary allowlists fields, preserves unknown flags and fingerprints IDs", () => {
  const payload = {
    status: 0, environment: "Sandbox", receipt: { bundle_id: "church.myshepherdapp", secret: "DO_NOT_LOG" },
    latest_receipt: "DO_NOT_LOG",
    latest_receipt_info: [{
      product_id: "church.myshepherdapp.plus.monthly",
      transaction_id: "PRIVATE_TRANSACTION", original_transaction_id: "PRIVATE_ORIGINAL",
      purchase_date_ms: "1790800000000", expires_date_ms: "1790900000000",
      cancellation_date_ms: "1790800001000", is_upgraded: "false", is_trial_period: "true",
      secret: "DO_NOT_LOG",
    }],
    pending_renewal_info: [{
      original_transaction_id: "PRIVATE_ORIGINAL", auto_renew_status: "0",
      auto_renew_product_id: "church.myshepherdapp.plus.yearly",
      is_in_billing_retry_period: "1", expiration_intent: "1",
    }],
  };
  const summary = summarizeAppleResponse(payload);
  assert.equal(summary.autoRenewEnabled, false);
  assert.equal(summary.billingRetry, true);
  assert.equal(summary.isUpgraded, false);
  assert.equal(summary.cancellationFieldPresent, true);
  assert.equal(summary.expirationIntent, 1);
  assert.equal(summary.isTrial, true);
  assert.match(summary.originalTransactionFingerprint!, /^[a-f0-9]{16}$/);
  assert.equal(summary.originalTransactionFingerprint, summarizeAppleResponse(payload).originalTransactionFingerprint);
  assert.doesNotMatch(JSON.stringify(summary), /DO_NOT_LOG|PRIVATE_TRANSACTION|PRIVATE_ORIGINAL/);
  const absent = summarizeAppleResponse({});
  assert.equal(absent.autoRenewEnabled, null);
  assert.equal(absent.expiryInPast, null);
  assert.equal(absent.renewalEntryPresent, false);
  const hostile = summarizeAppleResponse({
    environment: "SECRET_ENV", receipt: { bundle_id: "SECRET_BUNDLE" },
    latest_receipt_info: [{ product_id: "SECRET_PRODUCT", expires_date_ms: "SECRET_DATE" }],
  });
  assert.doesNotMatch(JSON.stringify(hostile), /SECRET/);
  assert.equal(hostile.bundleId, "other");
  assert.equal(hostile.productId, "unknown");
});

test("diagnostics default off, accept only exact true and scope to one authenticated reviewer", () => {
  const previous = process.env.IAP_REVIEW_DIAGNOSTICS;
  try {
    for (const value of [undefined, "false", "1", "TRUE"]) {
      if (value === undefined) delete process.env.IAP_REVIEW_DIAGNOSTICS;
      else process.env.IAP_REVIEW_DIAGNOSTICS = value;
      assert.equal(beginIapDiagnostic(request(), response(), "entitlement"), undefined);
    }
    process.env.IAP_REVIEW_DIAGNOSTICS = "true";
    for (const email of ["ordinary@example.com", "apple-review@myshepherdapp.church", "apple-review+expired@myshepherdapp.church"]) {
      assert.equal(beginIapDiagnostic(request(email), response(), "entitlement"), undefined);
    }
    assert.equal(beginIapDiagnostic({ header: () => undefined } as unknown as Request, response(), "entitlement"), undefined);
  } finally {
    if (previous === undefined) delete process.env.IAP_REVIEW_DIAGNOSTICS;
    else process.env.IAP_REVIEW_DIAGNOSTICS = previous;
  }
});

test("finish logger captures final 304 without headers, secrets or behavior changes; sink failures are isolated", () => {
  const previous = process.env.IAP_REVIEW_DIAGNOSTICS;
  const info = console.info;
  const logs: string[] = [];
  try {
    process.env.IAP_REVIEW_DIAGNOSTICS = "true";
    console.info = (...args) => { logs.push(args.join(" ")); };
    const res = response();
    const diagnostic = beginIapDiagnostic(request(), res, "entitlement")!;
    diagnostic.recordStored({ tier: "plus", originalTransactionId: "PRIVATE_ORIGINAL" });
    diagnostic.recordDecision({ tier: "plus", productId: "church.myshepherdapp.plus.monthly", expiresAt: "2026-10-01T00:00:00Z" });
    (res as unknown as EventEmitter).emit("finish");
    const row = JSON.parse(logs[0].slice(logs[0].indexOf("{")));
    assert.equal(row.httpStatus, 304);
    assert.equal(row.ifNoneMatchPresent, true);
    assert.equal(row.etagPresent, true);
    assert.equal(row.cachePolicy, "absent");
    assert.equal(res.statusCode, 304);
    assert.doesNotMatch(logs.join(""), /PRIVATE_ORIGINAL|private-header-value|private-etag-value|apple-review/);
    const broken = response();
    beginIapDiagnostic(request(), broken, "entitlement");
    console.info = () => { throw new Error("unavailable sink"); };
    assert.doesNotThrow(() => (broken as unknown as EventEmitter).emit("finish"));
  } finally {
    console.info = info;
    if (previous === undefined) delete process.env.IAP_REVIEW_DIAGNOSTICS;
    else process.env.IAP_REVIEW_DIAGNOSTICS = previous;
  }
});

test("one-hour process window and 200-request cap bound diagnostics", () => {
  const previous = process.env.IAP_REVIEW_DIAGNOSTICS;
  const now = Date.now;
  try {
    process.env.IAP_REVIEW_DIAGNOSTICS = "true";
    Date.now = () => now() + 3_600_001;
    assert.equal(beginIapDiagnostic(request(), response(), "entitlement"), undefined);
    Date.now = now;
    let accepted = 0;
    for (let i = 0; i < 205; i++) {
      if (beginIapDiagnostic(request(), response(), "entitlement")) accepted++;
    }
    assert.ok(accepted > 0 && accepted <= 200);
    assert.equal(beginIapDiagnostic(request(), response(), "entitlement"), undefined);
  } finally {
    Date.now = now;
    if (previous === undefined) delete process.env.IAP_REVIEW_DIAGNOSTICS;
    else process.env.IAP_REVIEW_DIAGNOSTICS = previous;
  }
});
