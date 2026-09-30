# Expired-entitlement reviewer demo

Implementation only. Do not describe this PR as production deployment or Apple approval.

## What this account represents

`apple-review+expired@myshepherdapp.church` is a dedicated consumer demo account,
seeded with Free access and a past Plus Monthly entitlement expiration.
It is an **explicit demo fixture**, not evidence of an actual expired Apple
purchase. Its original Apple transaction ID remains NULL; no receipt is fabricated.
Disclose this distinction in reviewer notes. Apple may require an actually expired
sandbox subscription instead; if so, complete and expire a real test transaction.
Do not claim purchase, restore, expiration, or resubscription was device-tested
until it actually was.

## Owner-controlled Railway rollout

1. Review and merge the backend PR. With no new variables, the two existing
   reviewer accounts continue unchanged and no account is created.
2. Set `REVIEWER_EXPIRED_PASSWORD_HASH` to a bcrypt cost-12 hash of the dedicated
   app-review password. Use the existing hidden-input `script/hash-reviewer-password.ts`
   if generating a new hash. Never paste plaintext into chat, logs, or a PR.
   Alternatively, explicitly copy the existing `REVIEWER_FREE_PASSWORD_HASH`
   in Railway's secure UI to reuse that **demo app password**, not the Gmail password.
3. Set `PROVISION_EXPIRED_REVIEWER_DEMO=true` and deploy through Railway.
   Existing `ENABLE_REVIEWER_SIGNIN=true` is still required.
4. Expected sanitized log: `[expired-reviewer-demo] created`.
   `preserved-existing` means nothing was overwritten: inspect/test that account
   rather than assuming it is still expired.
5. Remove `PROVISION_EXPIRED_REVIEWER_DEMO` after successful creation.
   Keep the password hash and reviewer login enabled throughout review.
6. Validate the new account on the actual iPad in candidate build 9.
   Build 8's generic reviewer form also accepts this email once backend-enabled.

Provisioning is transactional and insert-only. Existing users, purchases,
passwords, quotas, subscription products, and the Apple receipt verifier are
not reset or changed. A purchase by this demo account must survive relaunch,
sign-out, login, token refresh, and subsequent deploys.
Do not run `reset-reviewer-tiers.ts`: the old +free account was upgraded by
Ryan's September 30 sandbox purchase and must not be called clean Free now.

## Validation and review handoff

- First verify no active entitlement, past expiration, and purchase-sheet access
  for the expired fixture. Test actual purchases using a separate intended test
  identity, or allow this account's real purchase to expire before calling it
  expired again. Never reset it automatically at login or deployment.
- Confirm real receipt verification and Plus access, then native subscription
  management, cancellation/actual expiry, restore, and repurchase.
- The primary ASC username/password should identify the verified expired account.
  Enterprise stays an additional full-feature account in Notes.
  Prefer a genuinely expired Apple test purchase to satisfy the literal request;
  the existing +free account may be used once its real purchase has expired.
  The newly seeded account is not, by itself, proof this requirement is met.
- Provide complete notes as a full-field replacement only after physical-device QA.
  Suggested factual disclosure: "The primary account is preconfigured with an
  expired demo entitlement and no active paid access. This is a seeded demo state,
  not an Apple transaction history; subscription purchases use the normal StoreKit
  flow." Do not substitute this for a real expired transaction if Apple requires one.
- Preserve the app, four subscriptions, and subscription group together.

Apple demo access guidance:
https://developer.apple.com/help/app-store-connect/reference/app-review-information/

Apple sandbox expiration testing:
https://developer.apple.com/documentation/storekit/testing-an-auto-renewable-subscription

## Automated checks

TypeScript, the production build, and all 122 backend tests passed locally.
Includes production routing for all three reviewer identities and insert-only
provisioning tests. No live database, Apple receipt service, or physical device
was used by these automated tests.
