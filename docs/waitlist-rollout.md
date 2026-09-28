# My Shepherd mobile launch waitlist

## Scope and safety

This PR adds an isolated web page, waitlist routes/table, welcome email adapter,
and owner-only dashboard view. It does not modify `shepherd-mobile`, App Store
Connect, reviewer credentials, reviewer login, magic-link login, app users,
entitlements, subscription products, Universal Links, AI endpoints, or the
existing homepage/privacy page. Existing auth middleware is unchanged.

The shared backend still requires a normal Railway deployment when merged.
That is not a new mobile build, but it is not zero deployment risk. Review the
diff and CI before merging; keep all Apple reviewer variables intact. If you
prefer no shared-backend restart during review, hold this PR until approval.

New collection is disabled unless `WAITLIST_ENABLED=true`. The table is created
lazily on first waitlist data operation, with no changes to existing tables.

## Owner approval and launch

1. Review the private page preview, welcome email copy in `server/waitlist/email.ts`,
   and PR. Preview uses separate, temporary test storage and sends no emails.
2. Merge this backend/web PR only when comfortable with a normal backend restart.
3. In the production Railway service serving `app.myshepherdapp.church`, set:
   - `WAITLIST_ENABLED=true`
   - `WAITLIST_EMAIL_ENABLED=true`
4. Existing `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, and `SENDGRID_FROM_NAME`
   are used. Confirm the sender is verified and `EMAIL_DRY_RUN=false`.
   No new API keys are needed if these existing variables are configured.
   Do not change `ENABLE_REVIEWER_SIGNIN` or either reviewer password hash.
   Do not enable church automation or broad campaign sending for this feature.
5. Confirm the postal footer remains accurate before enabling email:
   Bar Above LLC, 523 California Ave, Oakdale, CA 95361-3005.
   It matches the existing published privacy page.
6. Use an address you control to test live signup, inbox delivery, and unsubscribe.
   Confirm the record appears in the owner dashboard and drops out of active
   exports after unsubscribe. Check your own email spam folder.
7. Recheck the existing web app and reviewer login after deployment.
8. Only then share the public waitlist link in approved launch content.

Future public URL: `https://app.myshepherdapp.church/waitlist/`

This PR does not add `myshepherdapp.church/waitlist` on the separately hosted
marketing domain. A short-domain redirect would be separate Cloudflare work.

## Signup flow

Required email and explicit consent/13+ acknowledgement; optional first name and
iPhone/Android preference. No login, app account, payment, or third-party
tracking script. Ages 13–17 are asked to involve a parent or guardian.
The page carries a waitlist-specific privacy notice without editing the
privacy policy currently referenced by the mobile submission.

Attribution: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` are saved
as bounded simple labels only, not arbitrary full referring URLs. Example:

`https://app.myshepherdapp.church/waitlist/?utm_source=instagram&utm_medium=organic&utm_campaign=mobile_launch&utm_content=video_01`

Use stable non-personal campaign labels. Do not place emails or other personal
information in URLs.

The unique normalized email prevents duplicate rows. Subsequent signup attempts
do not overwrite existing metadata, change device preferences, resend the
welcome email, or override unsubscribe. There is no public email-lookup API.
Someone who opted out can contact support to rejoin; do not silently reactivate.

## Email and unsubscribe

First insert sends one welcome through existing SendGrid infrastructure when
enabled. No release date, automatic launch blast, or invitation to paid service.
Provider suppression lists are not bypassed. `sent` means provider accepted the
message, not confirmed inbox delivery. Delivery may be suppressed or bounce.

Email failure never discards a saved signup. The owner can see failed welcome
emails; there is no automatic resend loop or unsolicited repeated email.
If a crash occurs after insert but before completion, status can remain `pending`.
Investigate pending/failed entries privately rather than blindly retrying sends.

An opaque, random unsubscribe token is stored only as a SHA-256 hash. Email
links use a fragment so it does not appear in HTTP access logs. The landing page
requires the explicit unsubscribe button (POST), preventing link scanners from
unsubscribing users just by fetching a URL. Unsubscribe remains functional when
new signup collection is switched off. This is launch-list-only, not app deletion.

Future launch emails must respect both current local opt-outs and SendGrid
bounce/spam/global suppression lists. Include valid unsubscribe functionality
and the sender's postal address. Do not import an old export and assume it is
still current. Bulk sending is intentionally not implemented in this PR:
the owner must approve the audience and complete payload before a campaign.

## Owner dashboard

Sign into the existing admin dashboard with the platform owner account, then
choose **Launch list** in the sidebar. Ordinary church admins and consumer demo
tokens receive no data. Views include total, subscribed, unsubscribed, welcome
email failures, phone preference, attribution, and 50-row pagination.

**Export subscribed contacts** downloads a formula-escaped CSV without
unsubscribe tokens/hashes and excludes opted-out records. Exporting does not
send any messages. Treat the file as private contact data. Use support for
verified deletion/correction requests; no new destructive admin controls exist.

## Operations and limits

10 signup requests per 15 minutes per Express IP and 200/hour per process
globally, plus a hidden honeypot. Limits are conservative and include duplicate
and invalid attempts. The current proxy policy is unchanged; proxies may share
an IP bucket. Check legitimate signup traffic through Cloudflare/Railway before
launch, and adjust only these waitlist limits if needed.

Before multiple replicas or a large campaign, add a shared rate-limit store and
consider a verified bot challenge. This lightweight limiter/honeypot is not
claimed to eliminate spam. No IP addresses are stored in waitlist records.
The SQLite file must remain on the existing persistent volume; include the new
table in the existing backup/retention process.

Rollback: set `WAITLIST_ENABLED=false` to stop signups and
`WAITLIST_EMAIL_ENABLED=false` to stop welcomes. Keep the routes/table available
for unsubscribes. Do not delete contact or suppression data as a rollback.

## QA inventory

- Email validation, required consent, optional name/device, normalized duplicates.
- Honeypot, rate limit, malformed requests, unavailable/disabled service.
- Saved signup even on email failure; exactly one welcome on initial signup.
- Unsubscribe through real UI; GET does not mutate; no public resubscription.
- Owner-only list/export; anonymous, app user, and ordinary admin rejected.
- CSV formula safety, pagination, and exclusion of opt-outs.
- Real consumer reviewer and magic-link regression suite unchanged.
- Desktop/mobile, light/dark, keyboard focus, 200% zoom, error and success screens.
- Links, privacy disclosure, no horizontal overflow, no production calls in preview.
- Production email delivery and persistent-volume behavior require owner-approved
  deployment and are NOT claimed verified by local tests.
