/**
 * Founder digest sender (Phase B.5).
 *
 * Composes and dispatches the daily internal digest summarizing the prior
 * 24 hours of email deactivations. Recipient default: admin@barabove.app.
 *
 * Transactional path — uses sgSendMail directly with the global SendGrid
 * credentials (NOT a per-church config) since the digest is not tied to
 * any single church.
 */

import { emailConfig } from "./config";
import { logger } from "./logger";
import { sgSendMail } from "./sendgrid-client";
import { buildDigestSummary, type DigestSummary } from "./deactivations";
import {
  buildFounderDigestHtml,
  buildFounderDigestSubject,
} from "./templates/founder-digest";

export interface SendFounderDigestResult {
  ok: boolean;
  reason?: string;
  recipient?: string;
  subject?: string;
  newDeactivations?: number;
  totalDeactivated?: number;
  messageId?: string;
  error?: string;
}

/**
 * Resolve the SendGrid creds the digest will use. The digest is sent FROM
 * My Shepherd's global sender, NOT a church sender — it's internal mail,
 * not church-branded.
 */
function resolveTransactionalConfig(): { apiKey: string; fromEmail: string; fromName: string } | null {
  const apiKey = process.env.SENDGRID_API_KEY || "";
  if (!apiKey) return null;
  return {
    apiKey,
    fromEmail: process.env.SENDGRID_FROM_EMAIL || "hello@myshepherdapp.church",
    fromName:  process.env.SENDGRID_FROM_NAME  || "My Shepherd Admin",
  };
}

/**
 * Render the digest for an arbitrary summary. Exported so the preview
 * endpoint can dry-run the email without sending it.
 */
export function renderFounderDigest(summary: DigestSummary): { subject: string; html: string } {
  const dashboardUrl = `${emailConfig.appUrl.replace("app.myshepherdapp.church", "admin.myshepherdapp.church")}/#/deactivations`;
  return {
    subject: buildFounderDigestSubject(summary),
    html: buildFounderDigestHtml({ summary, dashboardUrl }),
  };
}

/**
 * Build the digest for the prior 24h and send it. Honors automation kill-switch.
 *
 * Behavior on edge cases:
 *   - automationEnabled=false → no send, returns ok:false reason="automation_disabled".
 *   - No SENDGRID_API_KEY → no send, returns ok:false reason="no_api_key".
 *   - 0 deactivations in window → STILL sends, so absence-of-signal is itself
 *     a signal. (A quiet day is good news; not getting the digest at all is
 *     a deployment problem we'd want to notice.)
 */
export async function sendFounderDigest(now: Date = new Date()): Promise<SendFounderDigestResult> {
  if (!emailConfig.automationEnabled) {
    logger.info("email.founder_digest.skipped", { reason: "automationEnabled=false" });
    return { ok: false, reason: "automation_disabled" };
  }

  const sgConfig = resolveTransactionalConfig();
  if (!sgConfig) {
    logger.warn("email.founder_digest.skipped", { reason: "no_sendgrid_api_key" });
    return { ok: false, reason: "no_api_key" };
  }

  const summary = buildDigestSummary(now);
  const { subject, html } = renderFounderDigest(summary);

  logger.info("email.founder_digest.sending", {
    to: emailConfig.founderDigestTo,
    newDeactivations: summary.newDeactivations.length,
    totalDeactivated: summary.totalDeactivated,
  });

  const result = await sgSendMail(sgConfig, {
    to: emailConfig.founderDigestTo,
    subject,
    html,
    categories: ["internal", "founder-digest"],
    customArgs: {
      digestType: "founder-deactivations",
      windowFrom: summary.windowFromIso,
      windowTo: summary.windowToIso,
    },
  });

  if (!result.success) {
    logger.error("email.founder_digest.send_failed", { error: result.error });
    return {
      ok: false,
      reason: "send_failed",
      recipient: emailConfig.founderDigestTo,
      subject,
      error: result.error,
    };
  }

  return {
    ok: true,
    recipient: emailConfig.founderDigestTo,
    subject,
    newDeactivations: summary.newDeactivations.length,
    totalDeactivated: summary.totalDeactivated,
    messageId: result.messageId,
  };
}
