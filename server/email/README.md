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
