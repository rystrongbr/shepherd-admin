/**
 * Email module — low-level SendGrid SDK wrapper.
 *
 * Centralizes:
 *  - Client initialization
 *  - Retry with exponential backoff on transient failures (429 / 5xx)
 *  - Structured error extraction
 *  - DRY_RUN short-circuit (returns synthetic 2xx responses without hitting net)
 *
 * Higher-level domain logic (contacts.ts, campaigns.ts, provisioning.ts)
 * calls `sgRequest()` and never touches sgClient directly.
 */

import sgMail from "@sendgrid/mail";
import sgClient from "@sendgrid/client";

import { emailConfig } from "./config";
import { logger } from "./logger";
import type { SendGridConfig } from "./types";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Initialize the @sendgrid SDKs with the church-scoped API key.
 *
 * NOTE: the SendGrid SDKs are stateful singletons — setApiKey() mutates a
 * module-level variable. In a multi-tenant server we MUST call this before
 * every request to make sure we're using the right church's key. The wrappers
 * below all do this; never call sgClient/sgMail directly from elsewhere.
 */
function initClients(apiKey: string) {
  sgMail.setApiKey(apiKey);
  sgClient.setApiKey(apiKey);
}

/**
 * Issue a SendGrid REST request with retry/backoff. Returns the response body.
 *
 * Throws on terminal failure (4xx that is not 429, or exhausted retries).
 * Honors EMAIL_DRY_RUN: short-circuits with a synthetic empty body and a log.
 */
export async function sgRequest<T = any>(
  config: SendGridConfig,
  method: HttpMethod,
  url: string,
  body?: Record<string, unknown>,
): Promise<T> {
  if (emailConfig.dryRun) {
    logger.info("sendgrid.dry_run", { method, url, hasBody: !!body });
    // Synthetic empty response so callers proceed as if the call succeeded.
    return {} as T;
  }

  initClients(config.apiKey);

  const maxAttempts = Math.max(1, emailConfig.maxRetries);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const request: Parameters<typeof sgClient.request>[0] = { method, url };
      if (body) request.body = body;

      const start = Date.now();
      const [response] = await sgClient.request(request);
      const status = (response as any)?.statusCode;
      const ms = Date.now() - start;

      logger.debug("sendgrid.ok", { method, url, status, ms, attempt });
      return (response as any).body as T;
    } catch (err: any) {
      lastErr = err;
      const status = err?.code || err?.response?.statusCode;
      const retryable = status === 429 || (status >= 500 && status < 600);

      logger.warn("sendgrid.error", {
        method,
        url,
        status,
        attempt,
        retryable,
        message: extractSendGridError(err),
      });

      if (!retryable || attempt === maxAttempts) {
        throw err;
      }

      // Exponential backoff with jitter: base * 2^(n-1) + 0-100ms
      const delay = emailConfig.retryBaseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
      await sleep(delay);
    }
  }

  // Should be unreachable — the loop either returns or throws.
  throw lastErr ?? new Error("sgRequest: exhausted retries with no captured error");
}

/**
 * Send a single transactional email via @sendgrid/mail.
 * Used by onboarding sequences (per-recipient personalization) and webhook acks.
 *
 * For broadcast campaigns to many recipients, use createCampaign / sendCampaign
 * via the Single Sends API instead — it's billed differently and supports
 * scheduling, A/B, and unsubscribe groups out of the box.
 */
export async function sgSendMail(
  config: SendGridConfig,
  payload: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    categories?: string[];
    customArgs?: Record<string, string>;
  },
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (emailConfig.dryRun) {
    logger.info("sendgrid.dry_run.send_mail", { to: payload.to, subject: payload.subject });
    return { success: true, messageId: "dry-run" };
  }

  initClients(config.apiKey);

  const maxAttempts = Math.max(1, emailConfig.maxRetries);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const [response] = await sgMail.send({
        to: payload.to,
        from: { email: config.fromEmail, name: config.fromName || config.fromEmail },
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        categories: payload.categories,
        customArgs: payload.customArgs,
      });
      const messageId = response?.headers?.["x-message-id"] as string | undefined;
      logger.info("sendgrid.send_mail.ok", { to: payload.to, attempt, messageId });
      return { success: true, messageId };
    } catch (err: any) {
      const status = err?.code || err?.response?.statusCode;
      const retryable = status === 429 || (status >= 500 && status < 600);
      const errorMsg = extractSendGridError(err);

      logger.warn("sendgrid.send_mail.error", {
        to: payload.to,
        attempt,
        status,
        retryable,
        message: errorMsg,
      });

      if (!retryable || attempt === maxAttempts) {
        return { success: false, error: errorMsg };
      }

      const delay = emailConfig.retryBaseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
      await sleep(delay);
    }
  }

  return { success: false, error: "sgSendMail: exhausted retries" };
}

/**
 * Extract a human-readable message from a SendGrid SDK error.
 * SendGrid nests them at err.response.body.errors[].message.
 */
export function extractSendGridError(err: any): string {
  const body = err?.response?.body;
  if (body?.errors?.length) {
    return body.errors.map((e: any) => e.message || JSON.stringify(e)).join("; ");
  }
  return err?.message || "Unknown SendGrid error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
