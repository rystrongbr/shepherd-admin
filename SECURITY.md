# My Shepherd security model

## Consumer authentication

Email magic links expire after 15 minutes. A verified link exchanges for a signed
JWT access token (default 15 minutes) and a rotating refresh token (default 30
days). Browser clients receive both as `httpOnly`, secure production cookies;
the token pair is also returned in JSON for React Native secure storage. The
server derives `req.user` from the token for profile, chats, reactions, and
donation actions. The historical `#?u=<id>&e=<email>` hash is intentionally
discarded; existing users sign in once after deployment.

Google sign-in accepts only an ID token. Its signature, issuer, audience, expiry,
and `email_verified` claim are verified using Google JWKS before account linking.

## Question limits and provider safety

| Actor | Limit |
| --- | ---: |
| Anonymous IP | 3/day |
| Signed-in free user | 3/day |
| My Shepherd+ | 20/day |
| Enterprise | 25/day |

Anonymous requests use `express-rate-limit`; signed-in requests use
`daily_question_counts`, keyed by the user's declared IANA timezone date (UTC
fallback). All Anthropic calls share a 20-slot queue. At more than 40 waiting
requests the API responds `429`; at more than 100 it fails fast. `RATE_LIMIT_BYPASS=true`
is an emergency, temporary bypass only.

## Browser protections

CORS permits only `myshepherdapp.church`, the consumer app, and the admin app in
production. Localhost origins are development-only. Helmet sets one-year HSTS
with preload, CSP, `nosniff`, `DENY` frames, strict referrer policy, and a
camera/microphone/geolocation-denying permissions policy. API logs record only
method, path, status, and duration; response bodies are never logged.

## Admin accounts

`ADMIN_PASSWORD` is not accepted. During the PostgreSQL migration, one active
owner is seeded at `ryan@myshepherdapp.church` with a random password emitted
once to the migration log. Sign in with email/password; admin access tokens
expire in 15 minutes and refresh tokens expire in 30 days. An existing admin can
add a named account with `POST /api/admin/users`:

```json
{ "email": "new.admin@example.com", "password": "at-least-14-characters", "role": "admin" }
```

To rotate a password, create a replacement named admin with the endpoint,
validate its login, then disable the old account directly in the `admin_users`
table until the password-change endpoint is added.

## Railway PostgreSQL

Provision a Railway PostgreSQL service, set `DATABASE_URL` on the app service,
generate `JWT_SECRET` using `openssl rand -base64 32`, configure
`GOOGLE_CLIENT_ID`, then run:

```sh
DATABASE_URL=... DB_PATH=/data/shepherd.db npx tsx server/migrations/000_initial_from_sqlite.ts
```

Take a Railway database backup and copy the SQLite volume before this command.
The migration is idempotent and creates the required foreign keys and indexes.
