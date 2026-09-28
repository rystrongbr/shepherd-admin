# Owner dashboard password recovery

This operator-only startup reset targets exactly the existing active owner
`ryan@myshepherdapp.church`. It does not add a public reset endpoint, create an
administrator, promote an account, or change the mobile binary, consumer users,
Apple reviewer credentials, subscriptions, or waitlist records.
The separately gated first-owner setup below is the only exception to
no account creation; it requires explicit operator approval and an empty
existing admin table. Normal password-reset behavior is unchanged.

## First-owner setup for a verified empty admin table

On September 28 the production diagnostic reported `admin-table-empty`,
`adminCount: 0`, `activeOwnerCount: 0`, `matchingAccountCount: 0`.
Ryan authorized preparing guarded first-owner setup. The code remains disabled
until the operator explicitly sets the additional service variable.

1. Review/merge the first-owner setup PR and wait for production deployment.
2. In the verified production `thriving-quietude` / `shepherd-admin` service,
   keep the two previously configured reset variables and privately saved password.
   Add **service-only** `OWNER_PASSWORD_RESET_ALLOW_FIRST_OWNER=true`.
   Do not use a shared/project variable or modify any reviewer/JWT/DB settings.
3. Deploy. Expect `[owner-password-reset] owner-created`.
4. Sign into https://admin.myshepherdapp.church using
   `ryan@myshepherdapp.church` and the password already saved privately in Railway.
   Open **Launch list** and verify the real test signup.
5. Delete **all three** `OWNER_PASSWORD_RESET_*` variables and deploy again.
   The owner account and password remain in the database.
6. Recheck owner sign-in and both Apple reviewer logins/tiers.

The first-owner flag must be exactly `true`. Creation and its one-time audit
record are atomic under an immediate SQLite transaction. Any existing admin
account, even inactive or non-owner, makes this mode return `bootstrap-refused`
without changing it. It also refuses a different operation ID if prior recovery
audit history exists. A reused operation ID returns `already-applied` and cannot
overwrite a password or recreate a deleted owner. With a missing admin table it
still refuses: it does not silently initialize an unknown database.

No consumer records or sessions, waitlist entries, reviewer credentials, or
mobile files are changed. Do not infer creation from deployment success alone:
check the explicit log result. Stop on any result other than `owner-created`
or an expected `already-applied`, and do not remove history to bypass the guard.

## Owner steps

1. Review and merge this PR. The deployment alone does nothing without the
   two variables below.
2. In Railway, open the production `shepherd-admin` service in
   `thriving-quietude`, using its existing persistent production database.
   Add these as **service variables only**, not shared/project variables:
   - `OWNER_PASSWORD_RESET_ID`: `owner-reset-20260928-01`
   - `OWNER_PASSWORD_RESET_PASSWORD`: a new unique password generated in your
     password manager. Use 24–40 ASCII characters, no leading/trailing spaces.
     Save it in your password manager with the admin email.
3. Apply both variables together and deploy. Never paste the password into
   chat, GitHub, screenshots, or command history. Do not change `ADMIN_PASSWORD`,
   `JWT_SECRET`, `DB_PATH`, or any `REVIEWER_*` variables.
4. The deployment log should show exactly:
   `[owner-password-reset] applied`
   No password or hash is logged by this recovery feature.
5. Sign into https://admin.myshepherdapp.church with the owner email and the new
   password. Open **Launch list** and confirm the test signup appears.
6. Delete **both** `OWNER_PASSWORD_RESET_*` service variables and deploy again.
   The database password remains changed. Recheck owner sign-in and both Apple
   reviewer paths. Do not resubmit or rebuild the mobile app.

The assistant prepares the PR; the owner approves the merge and production
configuration. No production credentials are included in the PR.

## One-time and failure behavior

- A unique reset ID is recorded with owner ID and timestamp in
  `owner_password_reset_audit`, in the same SQLite transaction as the update.
- Reusing an ID returns `already-applied`, even if the password value changed.
  Leaving variables present cannot overwrite a later password with that ID.
- Password validation: at least 20 characters, at most 72 UTF-8 bytes
  (bcrypt's limit), no outer whitespace. Stored as bcrypt cost 12, not plaintext.
- The password is removed from the process environment once read. Railway
  retains its saved variable until the owner deletes it; use step 6.
- Existing owner refresh tokens are revoked. Existing owner access JWTs remain
  valid until their configured expiry (default 15 minutes). This is forgotten
  password recovery, not a complete incident-response/session-revocation tool.
  Do not rotate the shared JWT secret: doing so affects mobile users/reviewers.
- Other administrators and consumer/reviewer refresh tokens are unchanged.
- `invalid-configuration`: fix the two variables; no password change occurred.
- `owner-unavailable`: exact owner was missing, inactive, not an owner, or
  ambiguous. No user is automatically created/reactivated/promoted. Stop and
  investigate the selected service/database rather than trying another account.
  The following `[owner-password-reset-diagnostic]` line now identifies the
  condition with read-only counts and allowlisted labels:
  - `admin-table-missing` or `admin-table-empty`: owner setup has not populated
    the currently selected database. Verify the service and persistent volume
    before considering separately approved owner creation.
  - `target-email-not-found`: other admin accounts exist, but none match the
    fixed email. Do not create another owner or guess email addresses.
  - `target-not-owner`: the matching account exists and is active, but is not
    an owner. A role change requires separate explicit approval and is not
    performed by this reset.
  - `target-inactive`: matching account is inactive; do not automatically enable.
  - `target-email-ambiguous`: more than one case-insensitive match; stop.
  - `diagnostic-unavailable`: inspection failed; no raw database error is logged.
  - `target-eligible`: the read-only follow-up found an eligible account; if the
    preceding reset reported unavailable, investigate concurrent account changes.
  Counts include total administrators, active owners, and matching records.
  A unique matching record also reports `targetRole` (`owner`, `admin`, `other`)
  and `targetActive`. No email, password, hash, token, raw role, or record ID is
  emitted. This diagnostic runs only when an explicitly configured reset
  reports `owner-unavailable`; no additional variable is required.
- `failed`: transaction rolled back. Consumer service continues starting.
  Stop and investigate privately; database errors are not emitted by this feature.
- No variables: no recovery SQL/schema changes and no recovery log entry.
- A future intentional reset requires a new unique ID. Never remove audit
  records to replay an old ID. Restoring a pre-reset database backup also restores
  the old password/audit state, which is another reason to remove the variables.

## Validation

Tests cover owner-only mutation, isolated reviewer/waitlist data, refresh-token
scope, replay prevention, validation, unavailable owners, and rollback.
Run `npm test`, `npm run test:client`, `npm run check`, and `npm run build`.
Existing reviewer integration tests cover login, tier, refresh, and magic links.
After owner deployment, live owner login and reviewer checks are still required.
