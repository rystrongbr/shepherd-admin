# IAP (In-App Purchase) module

Server-side receipt verification for the four App Store Connect subscriptions
registered against `church.myshepherdapp` (App ID `6804705145`):

| Product ID                                    | Tier granted | Duration | Price   |
| --------------------------------------------- | ------------ | -------- | ------- |
| `church.myshepherdapp.plus.monthly`           | `plus`       | 1 month  | $4.99   |
| `church.myshepherdapp.plus.yearly`            | `plus`       | 1 year   | $39.99  |
| `church.myshepherdapp.enterprise.monthly`     | `enterprise` | 1 month  | $29.99  |
| `church.myshepherdapp.enterprise.yearly`      | `enterprise` | 1 year   | $269.99 |

The tier grant then flows through the existing `authenticatedQuestionQuota`
middleware in `server/rate-limits.ts`, which caps daily questions at
`3 / 20 / 50` for `free / plus / enterprise`.

## Endpoints

### `POST /api/v1/iap/verify-receipt`

Body: `{ receiptData: string }` — the base64 receipt from StoreKit on the
device. Requires the caller's user Bearer token.

Response on success:

```json
{
  "ok": true,
  "tier": "plus",
  "productId": "church.myshepherdapp.plus.monthly",
  "expiresAt": "2026-09-24T15:42:00.000Z",
  "environment": "Production",
  "accessToken": "…",
  "refreshToken": "…"
}
```

Response on failure:
- `400` — malformed body
- `401` — missing / bad user token (from `requireUser`)
- `402` — Apple rejected the receipt (see `appleStatus` in body)
- `422` — receipt is valid but product id isn't recognized (catalog drift)
- `500` — misconfigured server (missing `APPLE_SHARED_SECRET`)

### `GET /api/v1/iap/entitlement`

Idempotent read that returns the user's current tier and expires-at. Also
downgrades the user to `free` if `expires_at` is in the past — this is a
belt-and-suspenders check for the case where Apple's renewal webhook (v1.1)
hasn't caught up yet.

## Configuration

The following environment variable must be set on the server:

- `APPLE_SHARED_SECRET` — from App Store Connect → App Information → App-Specific
  Shared Secret. This is a single 32-hex-char string that authenticates our
  calls to `verifyReceipt`.

## Migration

Run the migration once against each environment (dev/staging/prod Railway):

```bash
DATABASE_URL=… npx tsx server/migrations/001_iap_subscription_columns.ts
```

Adds four nullable columns to `app_users` plus two supporting indexes. Idempotent.

## Testing

### Unit tests

```bash
npm test -- server/iap/apple-verify.test.ts
```

Covers the product-id → tier mapping.

### Manual sandbox test

1. Set `APPLE_SHARED_SECRET` on the dev environment.
2. Build the iOS app with a StoreKit sandbox tester account.
3. Purchase a subscription in-app; capture the base64 receipt.
4. Hit `POST /api/v1/iap/verify-receipt` with a valid user JWT and the receipt.
5. Confirm the response `environment` is `Sandbox` and `tier` matches the product.
6. Confirm `app_users` row was updated with the four `subscription_*` columns.

The 24-hour propagation window from App Store Connect (products created
Aug 24, 2026 at ~8am PDT) means sandbox testing is only reliable after
Aug 25 at ~8am PDT.
