# Temporary reviewer IAP diagnostics

This is observation only, not a subscription fix. It does not change entitlement decisions, tokens, authentication, StoreKit, cache headers, pricing, the database schema, reviewer accounts, or the mobile binary.

## Scope and safeguards

- Disabled unless `IAP_REVIEW_DIAGNOSTICS=true` exactly.
- Only the authenticated app identity `apple-review+free@myshepherdapp.church` is eligible. Other customers and reviewer identities are not logged by this diagnostic.
- Automatically stops accepting diagnostic requests one hour after the server process starts, or after 200 eligible requests, whichever occurs first. A server restart resets this process-local window and limit, so remove the variable after the test.
- Output starts with `[iap-review-diagnostic]`. One record is emitted when each response finishes, including the final HTTP status (200, 304, or an error).
- Logs only allowlisted status/date/plan fields, presence-only cache indicators, and process-keyed transaction fingerprints. Fingerprints correlate within one process, not across restarts.
- No raw receipts, shared secrets, passwords, tokens, emails, user IDs, full transaction IDs, header values, or Apple Account credentials are logged. Unexpected bundle/product strings are reduced to `other`/`unknown`.
- No extra requests to Apple. The diagnostic observes the response from the existing verification call, after its normal sandbox fallback. Logger failures cannot fail verification.

## Run one controlled test

1. Review and merge this backend PR. Keep all existing variables unchanged.
2. In the production `shepherd-admin` Railway service, add `IAP_REVIEW_DIAGNOSTICS=true` and deploy the pending variable change. This starts the one-hour window.
3. In the existing TestFlight build 9, remain signed into the My Shepherd account `apple-review+free@myshepherdapp.church` that made the test purchase. Do not sign into another reviewer account.
4. Tap **Profile → Restore Purchases** once. Then open **Manage Subscription** once and note whether its native sandbox sheet is still empty. No new purchase is required.
5. Copy only the recent `[iap-review-diagnostic]` lines for analysis. Do not reveal Railway variable values or credentials.
6. Remove `IAP_REVIEW_DIAGNOSTICS` and deploy that removal. Remove diagnostic log exports when no longer needed under the normal retention policy.

No new iMac commands, Expo upgrades, mobile build, or App Store submission are required for this diagnostic.

## Interpret without overclaiming

- `apple` describes the sanitized Apple verification response, not a newly invented transaction.
- `apple.autoRenewEnabled=null` means absent/unrecognized, not false. The same rule applies to other nullable flags.
- `decision` shows the existing route's chosen tier, product, and expiration. `storedTier` is the tier before the existing entitlement GET's downgrade check.
- `storedOriginalTransactionFingerprint` can be compared to `apple.originalTransactionFingerprint` within the same server process.
- An expired receipt plus a paid verification decision exposes the known entitlement inconsistency. This PR intentionally does not repair it.
- A matching active Apple receipt plus an empty native management sheet narrows the issue toward the device/StoreKit path, but does not alone prove an Apple bug.
- A final HTTP 304 shows server-side conditional revalidation. This log cannot determine whether iOS delivers a cached 200/body or a raw 304 to JavaScript. Do not call caching the root cause from these logs alone.
- Refund/revocation indicators are not equivalent to turning off future auto-renewal.

Apple's subscription-management API displays active subscriptions; receipt-state evidence is necessary before interpreting an empty sheet ([Apple API documentation](https://developer.apple.com/documentation/storekit/appstore/showmanagesubscriptions(in:))). Access must be reconciled with subscription lifecycle state rather than receipt validity alone ([Apple subscription billing guidance](https://developer.apple.com/documentation/storekit/handling-subscriptions-billing)).

## Validation

Unit tests cover the flag, exact account scope, output allowlist, nullable flags, fingerprints, final 304 status, logger failure isolation, one-hour window, and request cap.

An isolated integration test runs the real IAP routes with an in-memory SQLite database and mocked Apple HTTP responses. It compares diagnostics on/off, preserves 200/304 behavior and existing tier decisions, checks sandbox fallback, verifies no logging for another account, and checks rejected receipts and observer errors. It does not make live Apple purchases or inspect production data.
