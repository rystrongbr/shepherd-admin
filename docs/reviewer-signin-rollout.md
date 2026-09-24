# Reviewer sign-in rollout

Status: implementation only. No production credentials or deployment included.

## Contract

`POST /api/v1/user/reviewer-signin` (also `/api/user/reviewer-signin`)
accepts `{ "email": "...", "password": "..." }`. It issues the existing
consumer access/refresh token pair for exactly these pre-existing identities:

- `apple-review@myshepherdapp.church`: provision as Enterprise.
- `apple-review+free@myshepherdapp.church`: provision as Free.

The database remains authoritative for tiers. Login does not reset purchases,
grant admin rights, create users, or send email. Normal magic-link routes are unchanged.
Reviewer access is real app access, not a mock/demo with hidden functionality.

## Production configuration (owner approval required)

1. Merge/deploy this backend PR first. Until configured it returns 503.
2. Generate two distinct strong passwords in a password manager (20+ characters,
   at most 72 UTF-8 bytes). Do not reuse the Gmail inbox password.
3. Locally run `npx tsx script/hash-reviewer-password.ts` for each password.
   Input is hidden and not passed through command arguments or shell history.
   The output is a bcrypt cost-12 hash, not a password.
4. Set these Railway service variables using its secure variable editor:
   - `REVIEWER_ENTERPRISE_PASSWORD_HASH`: Enterprise password's hash.
   - `REVIEWER_FREE_PASSWORD_HASH`: Free password's hash.
   - `ENABLE_REVIEWER_SIGNIN=true`.
5. Verify both existing accounts are present. If tier reset is needed, inspect
   the existing `script/reset-reviewer-tiers.ts` output and get approval before
   running it against production: it changes only these accounts and clears
   their subscription records. Never reset them while Apple is testing purchases.
6. Check production via the new mobile build. Verify wrong-password denial,
   Enterprise access, Free paywall, sign-out/account switching, app relaunch,
   session refresh, purchase/restore, and ordinary magic-link sign-in.
7. Only after real-device validation, put the Enterprise email and its NEW APP
   password in ASC Sign-In Information, and Free credentials in Notes.

The account/password does not expire automatically. Do not rotate or disable
during review, hide the feature after review, or detect Apple devices.
The enable flag is an operational security switch, not reviewer detection.
Disabling the endpoint does not revoke already-issued sessions; handle a
credential/session compromise as a separate approved incident response.

## Rate limits and logging

20 requests per 15 minutes per Express-derived IP; 120 requests per 15 minutes
globally for this endpoint. Counts include successful requests; return 429 with
retry guidance. Limiters use process memory, matching this single-process
deployment. Before scaling to multiple processes/replicas, use a shared store.
The current app does not trust proxy headers; proxy IPs may share a bucket.
Do not enable unrestricted `trust proxy` or trust arbitrary forwarded headers
to work around that. Check limits through the actual Cloudflare/Railway path
before submitting. The guard fails closed when hashes/flag/accounts are absent.

No plaintext password, hash, token, or body is logged by this handler. Existing
request logs record only method/path/status/duration.

## Apple guidance

Apple requires full reviewer access through an active demo account:
https://developer.apple.com/app-store/review/guidelines/ (Before You Submit and 2.1).
Its demo account must not expire; additional accounts belong in Notes:
https://developer.apple.com/help/app-store-connect/reference/app-review-information/.
Disclose the reviewer sign-in in Notes; do not hide or change behavior for review
(2.3.1): https://developer.apple.com/app-store/review/guidelines/.
