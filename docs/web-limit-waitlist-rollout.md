# Web question allowance and mobile waitlist

## Boundary

This PR changes only the static consumer web interface, its tests and this guide.
No server routes, quotas, authentication, crisis classifier, IAP, database,
environment settings or mobile files change. No mobile build is required.

The Railway service serves both these static files and the mobile API. A merge
can still trigger a shared-service deployment; this is not a promise of zero
operational risk or of App Store approval. Keep the normal health check and
rollback plan. Do not alter reviewer credentials, reviewer flags or quota flags.

## Behavior

- Every successful Ask, follow-up, Go Deeper and passage explanation advances a
  browser-only invitation counter. After three, an inline mobile-waitlist card
  appears without covering the answer or redirecting the visitor.
- That counter is not a quota. It cannot block paid users, override the server,
  claim an exact remaining balance, or make an IP quota into a per-person quota.
  A daily local-storage key keeps invitation cadence across refreshes. A blocked
  storage API falls back to memory. No question contents or emails enter the key.
- A server-confirmed daily-limit rejection displays the limit/waitlist card.
  The last rendered answer stays readable; an unsuccessful typed question stays
  in the composer. On a fresh page there is no claim that an earlier answer is
  available.
- Other HTTP 429 responses display a temporary-capacity message, not an exhausted
  daily allowance. Network/server failures display an honest retry message.
- No failed AI request silently retries the legacy endpoint or displays static
  devotional copy as though it answered the question.
- Crisis responses remain distinct, suppress marketing and do not advance the
  invitation counter. The shared safety/quota ordering is unchanged. The
  exhausted-allowance notice includes a direct U.S. 988 link as well.

## What this deliberately does not change

The existing backend counts requests before answer generation, not only successful
answers. Ask, deeper and passage routes already share that counter. Failed
requests can consume quota. Guest limits use IP and a 24-hour window; signed-in
accounts use the existing date bucket and plan limits. This PR does not claim to
fix these semantics, cross-device guest identity, concurrent quota races, server
restarts, proxy configuration or shared-Wi-Fi grouping.

## Pre-merge production check

The current code defaults guest allowance to 3 and signed-in Free allowance to 3.
Live Railway variables were not readable through the available connector.
Before merging, the owner should confirm, without exposing any secrets:

- `RATE_LIMIT_ANONYMOUS_PER_DAY` is unset (default 3) or set to `3`.
- Whether `RATE_LIMIT_BYPASS` is `true`. Do not change this shared setting during
  Apple review. If true, pause and discuss the rollout rather than silently
  switching it off; this PR adds presentation, not enforcement.
- `WAITLIST_ENABLED` remains `true`, with the existing waitlist operational.

If deployment settings or a production check contradict the three-question
copy, hold the rollout. Do not test by consuming either Apple's Enterprise or
Free demo account allowance.

## Validation

```sh
node --test tests/web-question-limit.test.mjs
npm test
```

The new test covers response classification, three-answer invitation cadence,
refresh/day rollover, blocked storage, all request entry points, retained answer,
retained failed input, no fallback/double request, temporary capacity, network and
server errors, crisis suppression, and paid users continuing beyond three.

Before merging, inspect the diff: only `my-shepherd-app/`, `tests/` and this guide
should change. The existing server suite includes API-v1 and reviewer-sign-in
integration coverage using isolated test data, not Apple's live accounts.

Validation completed on September 29, 2026:

- 11 new web tests passed.
- 117 existing server/API/reviewer tests passed.
- Browser checks passed for Ask, Go Deeper, passage exploration, the inline
  invitation, exhausted allowance, retained last answer, capacity, offline,
  crisis response and continued paid access.
- Desktop, 390px mobile, 320px narrow and 200% text-scale checks passed. The
  existing header now wraps instead of overflowing narrow screens.
- Private preview uses clearly labeled sample answers, removes analytics and
  sign-in SDKs, and intercepts every API request. No production questions,
  reviewer quota, email or signup data were used during these checks.

## Rollout and rollback

Owner reviews and merges the PR after the checks above. Railway deploys using
the existing flow. Verify the public page and waitlist link, shared health route,
and a disposable non-reviewer web account if a live quota test is necessary.
Revert this PR or redeploy the prior Railway release to roll back. The separate
Cloudflare marketing upload is independent and does not merge with this PR.
