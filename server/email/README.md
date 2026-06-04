# `server/email/` — My Shepherd Email Module

This folder is the self-contained email product for My Shepherd. It owns
everything related to SendGrid: contact sync, campaign creation, onboarding
sequences (Phase C), webhooks (Phase B), and the weekly devotional cadence
(Phase D).

Today it ships as part of the `shepherd-admin` mono-repo (Option 2 in the
design discussion). It is structured so that we can lift the entire folder
into its own service later (Option 3) with minimal refactor.

---

## The four discipline rules

These exist so the module stays portable. **Do not break them without
discussion.**

### Rule 1 — One-way dependency

- Files in `server/email/` import from `@shared/schema` and from each other.
- Files in `server/email/` **must not** import from anywhere else in
  `server/` _except_ via `data.ts`.
- Outside callers (`server/routes.ts`) import only from `server/email/index.ts`.

### Rule 2 — Single public interface file (`index.ts`)

- `index.ts` is the only file outside callers reach.
- Adding a new public function = explicit export in `index.ts`.
- Internal helpers stay internal. If you find yourself wanting to import
  `./sendgrid-client` from `server/routes.ts`, stop and add a public function
  to `index.ts` instead.

### Rule 3 — No direct DB access from email logic

- All persistence goes through `data.ts`, which wraps `storage`.
- When we extract to Option 3, `data.ts` is the only file that changes — it
  becomes an HTTP client against the admin service. Everything else in the
  module continues to work unchanged.

### Rule 4 — Email-owned env vars are namespaced `EMAIL_*`

- See **Environment Variables** below.
- The `.env` for the eventual extracted service is literally `grep ^EMAIL_`.

---

## File map

```
server/email/
├── README.md             ← you are here
├── index.ts              ← PUBLIC interface (only export point)
├── config.ts             ← env var loading + kill-switch
├── logger.ts             ← structured (JSON) logger, tagged source=email
├── data.ts               ← repository layer; only file that imports storage
├── types.ts              ← public types
├── sendgrid-client.ts    ← low-level SDK wrapper, retry/backoff, DRY_RUN
├── provisioning.ts       ← custom fields, per-church list, sender resolution
├── contacts.ts           ← testConnection, syncMember, syncAllMembers, removeMember
├── campaigns.ts          ← createCampaign, sendCampaign, getCampaignStats
└── templates/
    ├── devotional.ts     ← buildDevotionalEmailHtml
    └── welcome.ts        ← buildWelcomeEmailHtml
```

Coming in Phases B–D (not in Phase A):

```
server/email/
├── segmentation.ts       ← Phase B: daily segment recompute
├── webhooks.ts           ← Phase B: SendGrid Event Webhook handler
├── sequences.ts          ← Phase C: onboarding 5-email drip
├── cadence.ts            ← Phase D: Mon/Wed/Fri devotional scheduler
├── content-library.ts    ← Phase D: rotation logic for bible_topic_content
└── crons.ts              ← Phase B/C/D: cron registration + EMAIL_AUTOMATION_ENABLED gate
```

---

## Environment Variables

| Name | Required? | Default | Purpose |
| --- | --- | --- | --- |
| `EMAIL_AUTOMATION_ENABLED` | no | `false` | Master switch for cron jobs (Phase B-D). When false, no automated email goes out. Admin-triggered broadcasts still work. |
| `EMAIL_DRY_RUN` | no | `true` in dev, `false` in prod | When true, SendGrid SDK calls are short-circuited and logged. Use for first-time tests on a new church. |
| `EMAIL_SENDGRID_WEBHOOK_PUBLIC_KEY` | required in prod | — | PEM-formatted Ed25519 public key from the SendGrid Event Webhook settings page. Required to verify webhook signatures. |
| `EMAIL_MAX_RETRIES` | no | `3` | Retry attempts for transient SendGrid failures (429 / 5xx). |
| `EMAIL_RETRY_BASE_DELAY_MS` | no | `500` | Base delay (ms) for exponential backoff. |
| `EMAIL_APP_URL` | no | `https://app.myshepherdapp.church` | URL used in template CTAs ("Open My Shepherd" buttons). |

Per-church SendGrid credentials (`sendgridApiKey`, `sendgridFromEmail`) live
on the `churches` row, not in env vars — that's how we stay multi-tenant.

---

## SendGrid dashboard checklist (manual setup)

These are things the email module **cannot** do automatically and a human has
to confirm in the SendGrid UI before the church is ready to send:

1. **Sender Authentication** — Authenticate the sending domain
   (`guacapp.com` or per-church domain). Without this, deliverability is poor.
2. **Verified Single Sender** — Verify the address in `church.sendgridFromEmail`
   (e.g. `ryan+shepherd@guacapp.com`). The module's provisioning step looks up
   this verified sender by email and stores its `senderId`; if the sender is
   not yet verified, provisioning will succeed but with a warning.
3. **Event Webhook** — Settings → Mail Settings → Event Webhook → enable, set
   the HTTP URL to `https://<your-domain>/api/email/webhook`, select these
   events: _delivered, opened, clicked, bounce, dropped, unsubscribe,
   spamreport_. Then enable **Signed Event Webhook** and copy the public key
   into `EMAIL_SENDGRID_WEBHOOK_PUBLIC_KEY`. (Phase B will surface a guided
   setup screen for this.)
4. **Suppression Groups** — Create at least one unsubscribe group per church
   (Marketing → Unsubscribe Groups). Phase C will let admins pick the group
   ID per campaign type.

---

## Extraction Playbook — moving from Option 2 → Option 3

When the operational triggers fire (deploy coupling pain, webhook bursts
slowing admin requests, dedicated person on the email product, enterprise
compliance requirement, or different scaling profile — see the design doc),
here is the lift-and-shift procedure.

### Estimated effort: 1-2 days

### Steps

1. **Create a new repo** `myshepherd-email` with its own `package.json`. Copy:
   - `server/email/` (this whole folder)
   - The email-owned slices of `shared/schema.ts`: `bibleTopicContent`,
     `sequenceEnrollments`, `emailEvents`, plus the email-related columns on
     `churches` and `members`.
2. **Replace `data.ts`** with an HTTP client against the admin service.
   The function signatures stay identical; only the body changes:
   ```ts
   // before (Option 2): storage.getChurch(id)
   // after  (Option 3): fetch(`${ADMIN_API}/churches/${id}`).then(r => r.json())
   ```
3. **Add an Express wrapper** that exposes the functions in `index.ts` as
   HTTP endpoints: `POST /v1/contacts/sync`, `POST /v1/campaigns`,
   `POST /v1/webhooks/sendgrid`, etc.
4. **Update `shepherd-admin`** so it calls the new service over HTTP instead
   of importing `./email`. The import path stays a single place to change.
5. **Move `EMAIL_*` env vars** to the new service's Railway project.
6. **Migrate the email tables** — either share the database via a read replica
   for the admin side, or stand up a dedicated DB for the email service and
   replicate the columns the email service needs to read (`churches`,
   `members`).
7. **Reconfigure the SendGrid Event Webhook URL** to point at the new
   service's domain.
8. **Run both old and new for ~1 week** with a feature flag in `routes.ts` so
   you can fall back without a redeploy.

### What you do NOT have to refactor

Because of Rules 1-4, you should not need to touch:
- `templates/` (pure functions, no I/O)
- `sendgrid-client.ts` (only depends on `config`, `logger`)
- `provisioning.ts`, `contacts.ts`, `campaigns.ts` (depend on `data` and
  `sendgrid-client`, both of which you've already updated)
- `index.ts` (its surface is the new HTTP contract)

---

## How to test changes locally

```bash
# 1. Make sure EMAIL_DRY_RUN=true is set (default in development)
# 2. Run the dev server:
npm run dev

# 3. Hit a provisioning route from another terminal:
curl -X POST http://localhost:5000/api/email/churches/1/provision

# 4. Look for source=email JSON lines in the server logs.
```

For end-to-end testing with a real SendGrid account, set `EMAIL_DRY_RUN=false`
and use a test SendGrid sub-account so you can verify deliverability without
risking your main sending reputation.

---

## Phase B: Webhook handler + Segmentation cron

Phase B adds two pieces of automation on top of the Phase A foundation:

1. **SendGrid Event Webhook handler** (`webhook.ts`) — receives delivery /
   bounce / open / click / unsubscribe / spam events from SendGrid and
   updates member state (bounce counters, unsubscribed flag, deactivation).
2. **Nightly segmentation cron** (`cron.ts` + `segmentation.ts`) — recomputes
   each member's engagement segment once per day and pushes the result to
   SendGrid as a custom field for list filtering.

### File layout (Phase B additions)

```
server/email/
├── webhook.ts         # Ed25519 signature verify + event dispatch
├── segmentation.ts    # computeSegment (pure) + recalculateSegments
├── cron.ts            # node-cron registration + start/stop helpers
```

All Phase B files obey the same four rules as Phase A — only `data.ts`
imports `../storage`, only `index.ts` is the public surface, etc.

### Webhook: `POST /api/email/webhook`

- Authenticated by Ed25519 signature, NOT by the admin bearer token. The
  route is added to the `PUBLIC` allowlist in `server/routes.ts`.
- Raw body middleware is registered in `server/index.ts` BEFORE
  `express.json()` — the signed payload is `timestamp + rawBody` as bytes,
  so the body cannot be JSON-parsed before verification.
- Returns **503** if `EMAIL_SENDGRID_WEBHOOK_PUBLIC_KEY` is not set
  (intentional — defense against accidentally accepting unsigned events).
- Returns **401** on bad signature, **200** on success (even with partial
  per-event failures) so SendGrid does not retry-storm.

**Events handled:**

| SendGrid event       | Effect                                            |
| -------------------- | ------------------------------------------------- |
| `delivered`          | Reset `bounceCount` to 0                          |
| `open`               | Bump `lastEngagedAt`                              |
| `click`              | Bump `lastEngagedAt`                              |
| `bounce` (hard)      | Increment counter; deactivate at `hardBounceLimit`|
| `bounce` (soft)      | Increment counter; deactivate at `softBounceLimit`|
| `dropped`            | Increment counter (treated as hard)               |
| `unsubscribe`        | Set `unsubscribedAt`, mark inactive               |
| `group_unsubscribe`  | Same as `unsubscribe`                             |
| `spamreport`         | Immediate deactivate, regardless of counters      |
| `group_resubscribe`  | Clear `unsubscribedAt` if previously inactive     |

### Segmentation: 5-segment model

`computeSegment(inputs)` is a **pure function** of a member's state and the
current time. It returns one of:

| Segment    | Definition                                                       |
| ---------- | ---------------------------------------------------------------- |
| `inactive` | unsubscribed, bounced past limit, or no engagement in 90+ days   |
| `dormant`  | no engagement in 30–90 days                                      |
| `new`      | joined within last 21 days                                       |
| `engaged`  | engaged within 30 days **AND** is a donor                        |
| `active`   | engaged within 30 days, not a donor                              |

Thresholds are tunable via env vars (`EMAIL_DORMANT_AFTER_DAYS`,
`EMAIL_INACTIVE_AFTER_DAYS`, `EMAIL_NEW_WINDOW_DAYS`).

`recalculateSegments()` runs in two phases:

1. **DB phase** — compute new segment for every active member, write to DB.
2. **SendGrid phase** — for each church with at least one segment change,
   call `syncAllMembers(church)` to push updated custom fields upstream.

### Cron: 3 AM CT daily

- Schedule: `0 3 * * *` (configurable via `EMAIL_SEGMENTATION_CRON`)
- Timezone: `America/Chicago` (configurable via `EMAIL_SEGMENTATION_TZ`)
- Always **registered** at boot, but the handler short-circuits when
  `EMAIL_AUTOMATION_ENABLED=false`. The env var is read live on each tick,
  so you can flip the flag in Railway and the next run respects it without
  a redeploy.

Manual trigger for testing:

```bash
curl -X POST https://admin.myshepherdapp.church/api/email/segmentation/run \
  -H "Authorization: Bearer $ADMIN_PASSWORD"
```

### One-time SendGrid dashboard setup (manual)

Before turning on the webhook:

1. SendGrid → **Settings** → **Mail Settings** → **Event Webhook**
2. Set HTTP Post URL: `https://admin.myshepherdapp.church/api/email/webhook`
3. Select events: Delivered, Opened, Clicked, Bounced, Dropped,
   Unsubscribed, Group Unsubscribe, Group Resubscribe, Spam Report
4. Toggle **Signed Event Webhook** ON, copy the generated public key
5. Set Railway env var:
   `EMAIL_SENDGRID_WEBHOOK_PUBLIC_KEY=<base64 key from SendGrid>`
6. Test signature in SendGrid UI → verify a 200 response

### Required Phase B env vars

| Variable                              | Required | Default                |
| ------------------------------------- | -------- | ---------------------- |
| `EMAIL_SENDGRID_WEBHOOK_PUBLIC_KEY`   | yes      | (none — 503 if unset)  |
| `EMAIL_HARD_BOUNCE_LIMIT`             | no       | `1`                    |
| `EMAIL_SOFT_BOUNCE_LIMIT`             | no       | `3`                    |
| `EMAIL_DORMANT_AFTER_DAYS`            | no       | `30`                   |
| `EMAIL_INACTIVE_AFTER_DAYS`           | no       | `90`                   |
| `EMAIL_NEW_WINDOW_DAYS`               | no       | `21`                   |
| `EMAIL_SEGMENTATION_CRON`             | no       | `0 3 * * *`            |
| `EMAIL_SEGMENTATION_TZ`               | no       | `America/Chicago`      |

All Phase A env vars (`EMAIL_AUTOMATION_ENABLED`, `EMAIL_DRY_RUN`,
`EMAIL_APP_URL`, etc.) continue to apply.

---

## Phase B.5: Internal Founder Dashboard + Donor Tag

Phase B.5 is **internal-only**, gated behind staff auth. Nothing in B.5 changes
what church admins see — it gives the founder (Ryan) a private surface to
review automated deactivations and donor health before any of this graduates
to church-admin-facing dashboards.

### Why B.5 exists

Phase B's webhook+cron will quietly mark members as deactivated when they
bounce, unsubscribe, or hit spam. We want **30+ days of founder review with
≤10% false-positive rate** before exposing that to the 12+ pilot churches.
B.5 is the review surface.

### Design: three-axis member identity

Phase B.5 separates three concerns that were getting tangled on the `segment`
column:

| Field                | Owner            | Vocabulary                                   | Purpose                                          |
| -------------------- | ---------------- | -------------------------------------------- | ------------------------------------------------ |
| `segment`            | Church admin     | `new_visitor`/`regular`/`volunteer`/`inactive`/`donor` | Human-managed pastoral classification. Automation never touches this. |
| `engagementSegment`  | Cron (machine)   | `new`/`active`/`engaged`/`dormant`/`inactive` | Phase B's nightly engagement classification.    |
| `isDonor` + `donorSince` | Donations flow + nightly recompute | Boolean + ISO date                  | Has this person ever given? Set on first completed donation, recomputed nightly as a safety net. |

Plus the deactivation pair (separate from inactivity):

| Field                | Owner            | Purpose                                                                  |
| -------------------- | ---------------- | ------------------------------------------------------------------------ |
| `deactivatedAt`      | Webhook          | ISO timestamp the member was removed from sending. Empty string = active. |
| `deactivationReason` | Webhook          | Free-text reason: `hard bounce x1 (mailbox full)`, `unsubscribe`, `spam_report`, etc. |

**Key invariant:** the webhook stops overwriting `segment`. The webhook now
writes `deactivatedAt` + `deactivationReason`. The segmentation cron writes
`engagementSegment`. Donations write `isDonor` + `donorSince`. The
human-curated `segment` column is no longer touched by automation.

### Donor tag — when and how it gets set

1. **Primary trigger**: when a donation transitions to `completed` (Stripe
   webhook or manual mark-complete), the donations handler should call
   `recomputeDonorFlagsForEmail(email)` (or update the row directly). This
   sets `isDonor = 1` and `donorSince = <ISO of first completed donation>` if
   not already set.
2. **Safety net**: a nightly recompute (`recomputeDonors()` exported from
   `index.ts`) re-walks the donations table and ensures every member with
   ≥1 completed donation has the flag set. This catches any drift from
   missed hooks or backfilled data.
3. **Never auto-cleared**: a donor is a donor forever. Deactivating their
   email does not remove the donor flag — that's the whole point of the
   "donors deactivated" digest section.

### Deactivations dashboard (frontend)

Lives at `/#/deactivations`, sidebar entry under **Manage** with a yellow
badge showing `summary.newInWindow`.

Three top-line cards:

- **New (last 24h)** — count of `deactivatedAt` within the digest window
- **Donors deactivated (24h)** — donors among that group (most urgent review)
- **Total backlog** — every member currently in deactivated state

Filters: reason chips (All / Hard bounce / Soft bounce / Unsubscribe / Spam /
Other), time window (7d/30d/90d/all), "Donors only" toggle.

Table columns: Member (with Donor + Unsub badges), Church, Reason
(category + raw string), Deactivated (CT), Bounces.

### Restore (manual reactivate) — gated

When `EMAIL_DEACTIVATION_RESTORE_ENABLED=true`:

- A **Restore** button appears on each row.
- Clicking opens a confirm dialog with an optional note (logged for audit).
- On submit, `POST /api/email/deactivations/:id/restore` runs:
  1. Clears `deactivatedAt` + `deactivationReason`
  2. Resets `bounceCount` to 0
  3. **Does NOT clear `unsubscribedAt`** unless original reason was `spam_report`.
     Honest unsubscribes always stand — Restore reactivates the member's
     internal tracking but they still won't receive marketing email.
  4. Best-effort SendGrid re-sync via the existing `syncMember` helper.

When the env flag is `false` (default): the button is hidden in the UI, and
the backend returns `409 { reason: "restore_disabled" }`. The dashboard is
read-only by default; you flip the flag once you trust the data.

### Founder digest — 8 AM CT daily

A second cron (registered alongside segmentation) sends a daily email to
`admin@barabove.app`:

- Subject: `[My Shepherd] Founder Digest — N new deactivations (D donors)`
- Sections: donor priority list, by-reason rollup, table of yesterday's deactivations, total backlog
- **Sends even with 0 deactivations** — absence of signal is signal too. A
  silent day means "nothing broke", not "we forgot to send".
- Uses global `SENDGRID_API_KEY` (transactional sender:
  `hello@myshepherdapp.church`), not a per-church key.
- Honors `EMAIL_AUTOMATION_ENABLED` — kill-switch suppresses both
  segmentation and the founder digest.
- Dashboard deep-link: `https://admin.myshepherdapp.church/#/deactivations`

Manual triggers:

- `POST /api/email/founder-digest/preview` — render subject + HTML without sending
- `POST /api/email/founder-digest/run` — send right now (still honors kill-switch)
- `POST /api/email/donors/recompute` — manual safety-net donor recompute

### Phase B.5 endpoints

| Endpoint                                          | Purpose                                       |
| ------------------------------------------------- | --------------------------------------------- |
| `GET  /api/email/deactivations`                   | List + summary; query: `since`/`reason`/`donorsOnly`/`limit` |
| `POST /api/email/deactivations/:id/restore`       | Restore one member; body `{ note? }`; gated  |
| `POST /api/email/founder-digest/preview`          | Render the digest without sending             |
| `POST /api/email/founder-digest/run`              | Send the digest now                           |
| `POST /api/email/donors/recompute`                | Manual donor-flag safety-net recompute       |
| `GET  /api/email/status`                          | Now includes `founderDigest` block + `deactivationRestoreEnabled` |

### Graduation criteria (B.5 → church-admin facing)

The founder dashboard stays internal until **all three**:

1. **30+ days** of daily review with no alarming false positives
2. **≤10% false-positive rate** on deactivations (measured by Restore usage)
3. **Thresholds stable for 14+ days** — no churn on `EMAIL_HARD_BOUNCE_LIMIT`
   or `EMAIL_SOFT_BOUNCE_LIMIT`

When all three hold, we can build the church-admin-facing version (per-church
scope, less metadata, simpler "your member X is no longer reachable" UX).

### Phase B.5 env vars

| Variable                                | Required | Default                |
| --------------------------------------- | -------- | ---------------------- |
| `EMAIL_FOUNDER_DIGEST_TO`               | no       | `admin@barabove.app`   |
| `EMAIL_FOUNDER_DIGEST_CRON_SCHEDULE`    | no       | `0 8 * * *`            |
| `EMAIL_FOUNDER_DIGEST_CRON_TZ`          | no       | `America/Chicago`      |
| `EMAIL_DEACTIVATION_RESTORE_ENABLED`    | no       | `false` (read-only)    |

All Phase A and Phase B env vars continue to apply.

### Confirmation: the four discipline rules

Phase B.5 follows the same architectural rules as Phase A and B:

1. **One-way dependency** — only `data.ts` imports `../storage`. The new
   `listDeactivatedMembers`, `restoreDeactivatedMember`,
   `countDeactivationsBetween`, `recomputeDonorFlags` methods are all
   wrapped through `data.ts`.
2. **Single public surface** — only `index.ts` re-exports.
   `listDeactivations`, `buildDigestSummary`, `restoreMember`,
   `recomputeDonors`, `categorizeReason`, `sendFounderDigest`,
   `renderFounderDigest`, `runFounderDigestNow`, and the relevant types are
   all exported from there; nothing else outside `server/email/` reaches in.
3. **Namespaced env vars** — all new vars start with `EMAIL_` and are
   resolved through `emailConfig`. The cron file's one documented exception
   (live `process.env.EMAIL_AUTOMATION_ENABLED` read for the kill-switch)
   continues to apply to the new digest cron.
4. **Imports through `@shared/schema`** — the new schema columns
   (`engagementSegment`, `deactivatedAt`, `deactivationReason`, `isDonor`,
   `donorSince`) live in `shared/schema.ts` and are accessed via the same
   path everywhere.
