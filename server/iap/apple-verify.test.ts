/**
 * Unit tests for the Apple IAP verify helpers.
 *
 * These are pure-function tests over the productId -> tier mapping only.
 * Network-facing behavior (verifyAppleReceipt hitting Apple's endpoint) is
 * tested with a live sandbox receipt in the manual QA plan documented in
 * server/iap/README.md — not here.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  productIdToTier,
  PRODUCT_ID_PLUS_MONTHLY,
  PRODUCT_ID_PLUS_YEARLY,
  PRODUCT_ID_ENTERPRISE_MONTHLY,
  PRODUCT_ID_ENTERPRISE_YEARLY,
} from "./apple-verify";

test("productIdToTier maps Plus Monthly to plus", () => {
  assert.equal(productIdToTier(PRODUCT_ID_PLUS_MONTHLY), "plus");
});

test("productIdToTier maps Plus Yearly to plus", () => {
  assert.equal(productIdToTier(PRODUCT_ID_PLUS_YEARLY), "plus");
});

test("productIdToTier maps Enterprise Monthly to enterprise", () => {
  assert.equal(productIdToTier(PRODUCT_ID_ENTERPRISE_MONTHLY), "enterprise");
});

test("productIdToTier maps Enterprise Yearly to enterprise", () => {
  assert.equal(productIdToTier(PRODUCT_ID_ENTERPRISE_YEARLY), "enterprise");
});

test("productIdToTier returns null for an unknown product id", () => {
  assert.equal(productIdToTier("church.myshepherdapp.legacy.free"), null);
  assert.equal(productIdToTier(""), null);
  assert.equal(productIdToTier("com.example.other"), null);
});

test("product ids match the App Store Connect catalog exactly", () => {
  // These constants are what the server compares receipts against. If the
  // App Store Connect product IDs ever change, this test is a fast fail
  // that reminds the maintainer to update both sides.
  assert.equal(PRODUCT_ID_PLUS_MONTHLY, "church.myshepherdapp.plus.monthly");
  assert.equal(PRODUCT_ID_PLUS_YEARLY, "church.myshepherdapp.plus.yearly");
  assert.equal(PRODUCT_ID_ENTERPRISE_MONTHLY, "church.myshepherdapp.enterprise.monthly");
  assert.equal(PRODUCT_ID_ENTERPRISE_YEARLY, "church.myshepherdapp.enterprise.yearly");
});
