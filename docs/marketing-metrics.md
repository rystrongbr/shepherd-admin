# Marketing metrics endpoint

`GET /api/admin/metrics/marketing?days=30` returns read-only, aggregate-only funnel
numbers (no emails, names, ZIPs, church names, question text, or any IDs).

- `days`: integer 1–365 (default 30; larger values are capped at 365; anything else is 400).
- `includeInternal=true`: include test users (`is_test_user = 1`) and `@myshepherdapp.church`
  staff/store-review accounts, which are excluded by default.
- All daily buckets are UTC days, except `activeAskers` / `signedInQuestions` / `usersAtDailyLimit`,
  which use the quota ledger's date (user-local when the client sends a timezone).

## Auth

Either the existing admin session (admin JWT as `Authorization: Bearer` or the
`admin_access_token` cookie), or `Authorization: Bearer $MARKETING_METRICS_TOKEN`.
The token is only checked on this route; every other admin route still requires an
admin session. If the env var is unset or shorter than 32 characters, the token path is off.
Rate limit: 120 requests / 15 min per IP.

Set it in Railway → service → Variables: `MARKETING_METRICS_TOKEN=$(openssl rand -hex 32)`, then redeploy.

```bash
curl -s -H "Authorization: Bearer $MARKETING_METRICS_TOKEN" \
  "https://app.myshepherdapp.church/api/admin/metrics/marketing?days=30"
```

## Response

`totals` (users, effective tier split, paid share, auth method, church affiliation counts),
`windowTotals`, `subscriptions` (active by product and store, manual grants, lapsed),
`donations`, `attribution` (stay-connected source labels, launch waitlist device/UTM),
`daily[]`, `definitions`, and `notDerivable` (what would need new tracking).
See `server/metrics/marketing.ts` for exact definitions.
