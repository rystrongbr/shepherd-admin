/**
 * Email module — SendGrid Event Webhook handler (Phase B).
 *
 * SendGrid posts engagement events (delivered, open, click, bounce, dropped,
 * unsubscribe, spamreport, group_unsubscribe) to a URL we configure in their
 * dashboard. This handler:
 *
 *   1. Verifies the Ed25519 signature on every request using the public key
 *      we stored in EMAIL_SENDGRID_WEBHOOK_PUBLIC_KEY. UNSIGNED REQUESTS ARE
 *      REJECTED in production — no key set, no acceptance.
 *
 *   2. Logs every event to the email_events table for audit + replay.
 *
 *   3. Updates the member record based on the event type:
 *        - delivered                                 → reset bounceCount (soft bounces clear on a good send)
 *        - open / click                              → bump lastEngaged
 *        - bounce (type=hard) / dropped              → bounceCount++; deactivate if ≥ hardBounceLimit
 *        - bounce (type=soft / undefined)            → bounceCount++; deactivate if ≥ softBounceLimit (consecutive)
 *        - unsubscribe / group_unsubscribe          → set unsubscribedAt; deactivate
 *        - spamreport                                → set unsubscribedAt; deactivate (logged for admin review)
 *
 * Bounce counter philosophy:
 *   We maintain a SINGLE `bounceCount` column rather than separate hard/soft
 *   columns. The counter increments on any bounce or drop and RESETS on the
 *   next successful delivery. The threshold check uses the policy applicable
 *   to the event currently being processed:
 *     - hard event arrives → check vs. hardBounceLimit (default 1)
 *     - soft event arrives → check vs. softBounceLimit (default 3)
 *   This gives soft bounces the forgiveness they need ("3 in a row") while
 *   still letting one hard bounce suppress immediately.
 *
 * Idempotency:
 *   SendGrid retries webhook deliveries on non-2xx responses. Recording the
 *   raw event with a fresh row each time is fine (email_events is an
 *   append-only audit log), and member-state updates are themselves
 *   idempotent (setting `status=inactive` twice is a no-op; counter resets
 *   land on the same value either way).
 *
 * Failure mode:
 *   If event-processing fails for any reason, we still return 2xx to SendGrid
 *   after logging the raw payload, so they don't retry-storm. The logged
 *   payload lets us reprocess later.
 */

import crypto from "crypto";
import type { Request, Response } from "express";
import { emailConfig } from "./config";
import { logger } from "./logger";
import { data } from "./data";
import type { Member } from "@shared/schema";

// ─── Ed25519 signature verification ──────────────────────────────────────────
//
// SendGrid signs each webhook POST with Ed25519. Headers:
//   X-Twilio-Email-Event-Webhook-Signature  — base64(signature)
//   X-Twilio-Email-Event-Webhook-Timestamp  — unix epoch seconds
// The signed payload is `timestamp + rawRequestBody` (concatenated as bytes).

const SIG_HEADER = "x-twilio-email-event-webhook-signature";
const TS_HEADER  = "x-twilio-email-event-webhook-timestamp";

/**
 * The SendGrid public key is delivered as base64-DER (SPKI) by the dashboard.
 * Node's crypto.verify accepts a KeyObject built from that DER, which is what
 * createPublicKey does when given a base64-decoded buffer in 'der'/'spki' format.
 *
 * We cache the parsed KeyObject on first use. If the env var changes after
 * boot (rotation), restart the service to pick up the new key.
 */
let cachedPublicKey: crypto.KeyObject | null = null;
let cachedPublicKeyRaw: string | null = null;

function getPublicKey(): crypto.KeyObject | null {
  const raw = emailConfig.webhookPublicKey;
  if (!raw) return null;
  if (cachedPublicKey && cachedPublicKeyRaw === raw) return cachedPublicKey;

  try {
    // SendGrid provides the key as base64. Decode it and import as DER/SPKI.
    const der = Buffer.from(raw, "base64");
    cachedPublicKey = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    cachedPublicKeyRaw = raw;
    return cachedPublicKey;
  } catch (err) {
    logger.error("email.webhook.public_key.parse_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    cachedPublicKey = null;
    cachedPublicKeyRaw = null;
    return null;
  }
}

export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureBase64: string | undefined,
  timestamp: string | undefined,
): boolean {
  if (!signatureBase64 || !timestamp) return false;

  const publicKey = getPublicKey();
  if (!publicKey) return false;

  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const signedPayload = Buffer.concat([Buffer.from(timestamp, "utf8"), bodyBuf]);
  const signature = Buffer.from(signatureBase64, "base64");

  try {
    return crypto.verify(null, signedPayload, publicKey, signature);
  } catch {
    return false;
  }
}

// ─── Event normalization ─────────────────────────────────────────────────────
//
// SendGrid posts an ARRAY of events per request, each with at least:
//   { event, email, timestamp, sg_event_id, sg_message_id, ... }
// Plus type-specific fields:
//   - bounce/dropped: type, reason, status
//   - click:          url
//   - open:           ip, useragent
// We normalize each into a small typed shape before persisting + reacting.

export type SendGridEventType =
  | "delivered"
  | "open"
  | "click"
  | "bounce"
  | "dropped"
  | "deferred"
  | "processed"
  | "unsubscribe"
  | "group_unsubscribe"
  | "group_resubscribe"
  | "spamreport";

export interface NormalizedEvent {
  type: SendGridEventType;
  email: string;
  timestamp: string;       // ISO
  messageId: string;
  contactId: string;
  campaignId: string;
  url: string;
  reason: string;
  bounceType: "hard" | "soft" | "";  // empty when not a bounce, or when SG omitted the field
  raw: Record<string, unknown>;
}

function normalize(event: Record<string, unknown>): NormalizedEvent | null {
  const type = String(event.event || "") as SendGridEventType;
  const email = String(event.email || "").toLowerCase().trim();
  if (!type || !email) return null;

  const tsSeconds = Number(event.timestamp);
  const iso = Number.isFinite(tsSeconds) ? new Date(tsSeconds * 1000).toISOString() : new Date().toISOString();

  return {
    type,
    email,
    timestamp: iso,
    messageId: String(event.sg_message_id || ""),
    contactId: String(event.sg_contact_id || ""),
    campaignId: String(event.singlesend_id || event.marketing_campaign_id || ""),
    url:        String(event.url    || ""),
    reason:     String(event.reason || event.response || ""),
    bounceType: (event.type === "bounce" || event.type === "blocked")
      ? "hard"
      : event.type === "soft"
        ? "soft"
        : (type === "bounce" || type === "dropped" ? "soft" : ""),
    raw: event,
  };
}

// ─── Member-state reactions ──────────────────────────────────────────────────

function deactivateMember(member: Member, reasonLabel: string, log = logger): void {
  if (member.segment === "inactive") return;
  data.updateMember(member.id, { segment: "inactive" });
  log.info("email.webhook.member.deactivated", {
    memberId: member.id, email: member.email, reason: reasonLabel,
  });
  data.recordActivity({
    churchId: member.churchId,
    type: "email_sent",
    description: `${member.firstName} ${member.lastName} auto-inactivated: ${reasonLabel}`,
    createdAt: new Date().toISOString(),
    meta: JSON.stringify({ memberId: member.id, reason: reasonLabel, auto: true }),
  });
}

function setUnsubscribed(member: Member, reasonLabel: string, log = logger): void {
  const patch: { unsubscribedAt: string; segment?: string } = {
    unsubscribedAt: new Date().toISOString(),
  };
  if (member.segment !== "inactive") patch.segment = "inactive";
  data.updateMember(member.id, patch);
  log.info("email.webhook.member.unsubscribed", {
    memberId: member.id, email: member.email, reason: reasonLabel,
  });
  data.recordActivity({
    churchId: member.churchId,
    type: "email_sent",
    description: `${member.firstName} ${member.lastName} unsubscribed (${reasonLabel})`,
    createdAt: new Date().toISOString(),
    meta: JSON.stringify({ memberId: member.id, reason: reasonLabel, auto: true }),
  });
}

function bumpEngagement(member: Member, at: string): void {
  data.updateMember(member.id, { lastEngaged: at });
}

function resetBounceCounter(member: Member): void {
  if (member.bounceCount > 0) {
    data.updateMember(member.id, { bounceCount: 0 });
  }
}

function findMember(event: NormalizedEvent): Member | undefined {
  // Prefer SendGrid contact id (stable across email changes), fall back to email.
  if (event.contactId) {
    const byContact = data.getMemberBySendgridContactId(event.contactId);
    if (byContact) return byContact;
  }
  if (event.email) {
    return data.getMemberByEmail(event.email);
  }
  return undefined;
}

function applyEvent(event: NormalizedEvent): void {
  const member = findMember(event);

  // Always log the raw event for replay/debug, even if we can't find a member.
  data.recordEmailEvent({
    churchId: member?.churchId ?? null,
    memberId: member?.id ?? null,
    sendgridContactId: event.contactId,
    sendgridMessageId: event.messageId,
    email: event.email,
    eventType: event.type,
    url: event.url,
    reason: event.reason,
    campaignId: event.campaignId,
    occurredAt: event.timestamp,
    rawPayload: JSON.stringify(event.raw),
  });

  if (!member) {
    // Event for an address we don't track (maybe a transactional send to a
    // non-member, e.g. admin@barabove.app). The audit row is enough.
    return;
  }

  const log = logger.withContext({ memberId: member.id, churchId: member.churchId, email: event.email });

  switch (event.type) {
    case "delivered": {
      // Successful delivery clears the soft-bounce counter so a member who
      // had 2 transient bounces and then receives a real email isn't
      // perma-penalized.
      resetBounceCounter(member);
      break;
    }

    case "open":
    case "click": {
      bumpEngagement(member, event.timestamp);
      break;
    }

    case "bounce":
    case "dropped": {
      const newCount = data.incrementBounceCount(member.id);
      const isHard = event.bounceType === "hard" || event.type === "dropped";
      const limit  = isHard ? emailConfig.hardBounceLimit : emailConfig.softBounceLimit;
      log.warn("email.webhook.bounce", {
        bounceType: isHard ? "hard" : "soft", newCount, limit, reason: event.reason,
      });
      if (newCount >= limit) {
        deactivateMember(member, `${isHard ? "hard" : "soft"} bounce x${newCount} (${event.reason || "no reason"})`, log);
      }
      break;
    }

    case "unsubscribe":
    case "group_unsubscribe": {
      setUnsubscribed(member, event.type, log);
      break;
    }

    case "spamreport": {
      // Spam complaints damage sender reputation more than bounces. Always
      // immediate, regardless of thresholds.
      setUnsubscribed(member, "spam_report", log);
      break;
    }

    case "group_resubscribe": {
      // Member opted back in to a specific group — keep the unsubscribedAt
      // for audit but clear the segment block.
      if (member.segment === "inactive") {
        data.updateMember(member.id, { segment: "regular" });
        log.info("email.webhook.member.resubscribed", { from: "group_resubscribe" });
      }
      break;
    }

    // processed / deferred — informational only, audit row is enough
    default:
      break;
  }
}

// ─── Express handler ─────────────────────────────────────────────────────────
//
// MUST be mounted with express.raw({ type: "application/json" }) middleware so
// the body is a Buffer (signature is computed over the raw bytes). The route
// registration in routes.ts handles that.

export function handleSendGridWebhook(req: Request, res: Response): void {
  const sig = String(req.headers[SIG_HEADER] || "");
  const ts  = String(req.headers[TS_HEADER]  || "");

  // The body comes in as a Buffer (express.raw) so we can both verify the
  // signature AND parse the JSON afterwards without losing the raw bytes.
  const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(String(req.body ?? ""), "utf8");

  if (!emailConfig.webhookPublicKey) {
    // Hard-fail in prod, log loudly. Phase B refuses to process unsigned
    // events ever — the public key MUST be configured.
    logger.error("email.webhook.rejected.no_public_key", {});
    res.status(503).json({ ok: false, error: "Webhook key not configured" });
    return;
  }

  const valid = verifyWebhookSignature(rawBody, sig, ts);
  if (!valid) {
    logger.warn("email.webhook.rejected.bad_signature", {
      hasSignature: !!sig, hasTimestamp: !!ts, bodyLength: rawBody.length,
    });
    res.status(401).json({ ok: false, error: "Invalid signature" });
    return;
  }

  let events: Record<string, unknown>[];
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    logger.warn("email.webhook.malformed_json", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Return 2xx so SendGrid doesn't retry-storm. We've logged it.
    res.status(200).json({ ok: true, processed: 0 });
    return;
  }

  let processed = 0;
  let skipped   = 0;
  for (const raw of events) {
    const normalized = normalize(raw);
    if (!normalized) { skipped++; continue; }
    try {
      applyEvent(normalized);
      processed++;
    } catch (err) {
      logger.error("email.webhook.event.process_failed", {
        eventType: normalized.type,
        email: normalized.email,
        error: err instanceof Error ? err.message : String(err),
      });
      // Still increment so totals report accurately; SendGrid is acked.
      skipped++;
    }
  }

  logger.info("email.webhook.batch_processed", { processed, skipped, total: events.length });
  res.status(200).json({ ok: true, processed, skipped });
}
