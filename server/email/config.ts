/**
 * Email module — runtime configuration.
 *
 * All env vars that the email module reads are namespaced EMAIL_* so they're
 * easy to lift when the module is extracted to its own service (see README).
 *
 * Kill-switch philosophy:
 *   - EMAIL_AUTOMATION_ENABLED=false (default in dev) means cron jobs do NOT
 *     fire and no transactional emails are dispatched. Admin-triggered
 *     broadcasts still work — they're explicit user actions.
 *   - EMAIL_DRY_RUN=true means the SendGrid client logs the request it
 *     *would* have made but does not actually hit the network. Use this in
 *     staging or for first-time tests on a new church.
 */

export interface EmailModuleConfig {
  /** Master switch for cron-driven email (onboarding sequences, weekly cadence, segmentation). */
  automationEnabled: boolean;
  /** If true, SendGrid SDK calls are short-circuited and logged instead. */
  dryRun: boolean;
  /** SendGrid webhook signing key (Ed25519 public key, base64). Required to verify webhooks. */
  webhookPublicKey: string;
  /** Max retry attempts for transient SendGrid API failures (429 / 5xx). */
  maxRetries: number;
  /** Base delay in ms for exponential backoff between retries. */
  retryBaseDelayMs: number;
  /** Default app URL used in template CTAs when a church does not override. */
  appUrl: string;

  // ─── Phase B: bounce / unsubscribe policy ────────────────────────────────
  /**
   * Number of hard bounces that flips a member to inactive.
   * Standard policy: 1 — hard bounce is a permanent failure, suppress immediately.
   */
  hardBounceLimit: number;
  /**
   * Number of CONSECUTIVE soft bounces that flips a member to inactive.
   * Standard policy: 3 — gives transient issues (full mailbox, server outage) a chance to clear.
   * Counter resets to 0 on any successful delivery.
   */
  softBounceLimit: number;

  // ─── Phase B: segmentation cron ──────────────────────────────────────────
  /**
   * Days of no opens/clicks before a member moves from "active" to "dormant".
   */
  dormantAfterDays: number;
  /**
   * Days of no opens/clicks before a member moves from "dormant" to "inactive"
   * (auto-suppressed from sends, not just labelled).
   */
  inactiveAfterDays: number;
  /**
   * Days since signup during which a member is considered "new" and routed
   * through the onboarding sequence (Phase C).
   */
  newWindowDays: number;
  /**
   * Cron schedule for the daily segmentation job, in node-cron format.
   * Default: "0 3 * * *" = 03:00 UTC daily (i.e. 9pm Pacific / 10pm Mountain / 11pm Central previous day).
   * NOTE: node-cron schedules are tz-aware via { timezone } option — see cron.ts.
   * Spec: 03:00 America/Chicago.
   */
  segmentationCronSchedule: string;
  /** IANA timezone for the segmentation cron schedule. */
  segmentationCronTz: string;

  // ─── Phase B.5: founder dashboard + digest ────────────────────────
  /**
   * Email address that receives the internal founder digest (daily summary
   * of deactivations). Defaults to admin@barabove.app — the Bar Above admin
   * alias backed by barabovellc5@gmail.com.
   */
  founderDigestTo: string;
  /**
   * Cron schedule for the daily founder digest, node-cron format.
   * Default: "0 8 * * *" America/Chicago = 08:00 Central daily.
   */
  founderDigestCronSchedule: string;
  /** IANA timezone for the founder digest cron. */
  founderDigestCronTz: string;
  /**
   * Whether the "Restore" action on the deactivations dashboard is allowed.
   * Default false — dashboard is read-only until we explicitly turn this on
   * after observing for a couple weeks. (Phase B.5.)
   */
  deactivationRestoreEnabled: boolean;
}

function readBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw === "true" || raw === "1" || raw === "yes";
}

function readInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function readString(name: string, defaultValue: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? raw : defaultValue;
}

export const emailConfig: EmailModuleConfig = {
  automationEnabled: readBool("EMAIL_AUTOMATION_ENABLED", false),
  dryRun:            readBool("EMAIL_DRY_RUN",            process.env.NODE_ENV !== "production"),
  webhookPublicKey:  process.env.EMAIL_SENDGRID_WEBHOOK_PUBLIC_KEY ?? "",
  maxRetries:        readInt("EMAIL_MAX_RETRIES",         3),
  retryBaseDelayMs:  readInt("EMAIL_RETRY_BASE_DELAY_MS", 500),
  appUrl:            process.env.EMAIL_APP_URL ?? "https://app.myshepherdapp.church",

  // Phase B — Standard bounce policy (tunable per env)
  hardBounceLimit:   readInt("EMAIL_HARD_BOUNCE_LIMIT", 1),
  softBounceLimit:   readInt("EMAIL_SOFT_BOUNCE_LIMIT", 3),

  // Phase B — Segmentation thresholds
  dormantAfterDays:  readInt("EMAIL_DORMANT_AFTER_DAYS",  30),
  inactiveAfterDays: readInt("EMAIL_INACTIVE_AFTER_DAYS", 90),
  newWindowDays:     readInt("EMAIL_NEW_WINDOW_DAYS",     21),

  // Phase B — Cron schedule (defaults to 03:00 America/Chicago daily)
  segmentationCronSchedule: readString("EMAIL_SEGMENTATION_CRON_SCHEDULE", "0 3 * * *"),
  segmentationCronTz:       readString("EMAIL_SEGMENTATION_CRON_TZ",       "America/Chicago"),

  // Phase B.5 — founder digest + dashboard restore gate
  founderDigestTo:           readString("EMAIL_FOUNDER_DIGEST_TO",           "admin@barabove.app"),
  founderDigestCronSchedule: readString("EMAIL_FOUNDER_DIGEST_CRON_SCHEDULE", "0 8 * * *"),
  founderDigestCronTz:       readString("EMAIL_FOUNDER_DIGEST_CRON_TZ",       "America/Chicago"),
  deactivationRestoreEnabled: readBool("EMAIL_DEACTIVATION_RESTORE_ENABLED",  false),
};
