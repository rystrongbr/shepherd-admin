# IAP lifecycle corrections

## Scope

This backend PR corrects current-access decisions before writing an entitlement or issuing an access token. It does not cancel, renew, create, or expire any Apple transaction.

- Validate Apple's receipt status, bundle identifier, environment, recognized product IDs, transaction identifiers, and dates.
- Separate an authentic receipt from active paid access. Expired or revoked purchases yield Free while retaining real transaction history.
- Disabling auto-renewal alone does not remove access before the paid period ends.
- Exclude upgraded/revoked transactions when selecting current access. Honor a matching, unexpired Apple billing-grace-period field.
- Add an ownership registry keyed by Apple environment and original transaction ID. Claim a purchase atomically; reject cross-account restores rather than silently transferring access. Legacy matching ownership is accepted; conflicting legacy rows require support review and are not rewritten.
- Support `syncOnly:true`: automatic refresh may reconcile an already-linked purchase but cannot bind a new device purchase to an arbitrary app login.
- Resolve current stored access when authorizing requests and issuing user tokens, preventing a previously issued Plus claim from overriding known expiry.
- Return private, non-cacheable entitlement bodies even when an older client sends a conditional request.
- Add `hasVerifiedSubscription` to entitlement responses for the build 10 compatibility gate.

## Database and account impact

Startup creates one empty table, `iap_transaction_owners`, if absent. There is no backfill, mass update, reset, receipt storage, or new credential. Ownership entries are created only when a verified receipt is subsequently processed.

The existing canceled Plus Monthly account must remain untouched. Its Apple period ends October 1, 2026 at 18:45:07 UTC (11:45:07 AM PDT), according to the live receipt inspected September 30. No date is hardcoded into this correction.

Manual reviewer Enterprise access without an IAP product remains intact. The previously seeded expired demo is still a simulated app entitlement, not genuine Apple transaction history.

## Deployment order and compatibility

Merge/deploy this backend first, then the mobile build 10 PR. Existing build 9 purchase/restore requests remain compatible and benefit from corrected tier decisions. New automatic mobile reconciliation requires `hasVerifiedSubscription:true`, so it stays off against an older backend.

Keep `IAP_REVIEW_DIAGNOSTICS` removed. No new Railway variable or iMac backend command is required.

Before production deployment, retain the current Railway volume backup according to the existing backup procedure. The migration is additive and preserves existing rows. Reverting the application commit leaves the new registry table harmlessly present, but reverting also reintroduces the old entitlement defects; do not drop the table as a rollback step.

## Validation and limits

The tests use an in-memory database and mocked Apple responses, not live transactions. They cover active access, canceled renewal, exact expiration boundary, refunds, upgrades, grace periods, invalid receipt identity/dates, duplicate ownership, ambiguous legacy accounts, expired restore, later renewal, tokens and stale-token authorization, and fresh entitlement responses.

Build 10 reconciles known receipts on startup, foreground, and StoreKit transaction events. This is not a server-notification implementation. While the mobile app is not running, this backend does not independently retrieve Apple's latest state. Any future web entitlement path requiring immediate renewal/refund updates without a mobile launch should receive a separate App Store Server Notifications or server-reconciliation implementation.

The old `verifyReceipt` integration remains; this is not a StoreKit 2 or App Store Server API migration. Native device QA is still required. Passing source tests does not establish App Review readiness.

Apple describes subscription dates, grace periods, refunds, and renewal handling in its [subscription billing documentation](https://developer.apple.com/documentation/storekit/handling-subscriptions-billing) and [pending renewal fields](https://developer.apple.com/documentation/appstorereceipts/responsebody/pending_renewal_info-data.dictionary).
