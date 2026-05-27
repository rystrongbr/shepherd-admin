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
  /** Master switch for cron-driven email (onboarding sequences, weekly cadence). */
  automationEnabled: boolean;
  /** If true, SendGrid SDK calls are short-circuited and logged instead. */
  dryRun: boolean;
  /** SendGrid webhook signing key (Ed25519 public key, PEM). Required to verify webhooks. */
  webhookPublicKey: string;
  /** Max retry attempts for transient SendGrid API failures (429 / 5xx). */
  maxRetries: number;
  /** Base delay in ms for exponential backoff between retries. */
  retryBaseDelayMs: number;
  /** Default app URL used in template CTAs when a church does not override. */
  appUrl: string;
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

export const emailConfig: EmailModuleConfig = {
  automationEnabled: readBool("EMAIL_AUTOMATION_ENABLED", false),
  dryRun:            readBool("EMAIL_DRY_RUN",            process.env.NODE_ENV !== "production"),
  webhookPublicKey:  process.env.EMAIL_SENDGRID_WEBHOOK_PUBLIC_KEY ?? "",
  maxRetries:        readInt("EMAIL_MAX_RETRIES",         3),
  retryBaseDelayMs:  readInt("EMAIL_RETRY_BASE_DELAY_MS", 500),
  appUrl:            process.env.EMAIL_APP_URL ?? "https://app.myshepherdapp.church",
};
