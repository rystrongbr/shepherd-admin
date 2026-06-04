/**
 * Email module — PUBLIC INTERFACE.
 *
 * This is the ONLY file outside server/email/ is allowed to import from.
 *   ✅  import { syncMember, ... } from "./email";
 *   ❌  import { sgRequest } from "./email/sendgrid-client";
 *
 * If you need something new from outside the module, add it here. If you find
 * yourself wanting to import internals, that's the signal to either:
 *   (a) widen the public interface intentionally, or
 *   (b) move your code inside server/email/.
 *
 * When the email module is extracted to its own service (see README), these
 * exports become the JSON contract for the HTTP API. Treat changes as
 * versioned.
 */

// ─── Domain functions ────────────────────────────────────────────────────────
export { provisionChurch } from "./provisioning";
export {
  testConnection,
  syncMember,
  syncAllMembers,
  removeMember,
} from "./contacts";
export {
  createCampaign,
  sendCampaign,
  getCampaignStats,
} from "./campaigns";

// ─── Templates (callers may render previews / customize copy) ────────────────
export { buildDevotionalEmailHtml } from "./templates/devotional";
export { buildWelcomeEmailHtml }    from "./templates/welcome";

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  SendGridConfig,
  MemberPayload,
  CampaignPayload,
  ProvisioningResult,
  SyncResult,
  CampaignCreateResult,
  CampaignSendResult,
  CampaignStats,
  ConnectionTestResult,
} from "./types";

// ─── Runtime configuration ────────────────────────────────────────────────────
// Exposed so the rest of the server (e.g., a /health endpoint or a banner in
// the admin UI) can show "Email automation is OFF" without poking env vars.
export { emailConfig } from "./config";

// ─── Phase B: Segmentation ───────────────────────────────────────────────────
// Pure compute function + nightly recalculator. `recalculateSegments` is the
// entry point the cron uses; `computeSegment` is exposed for unit tests and
// for any ad-hoc preview UI ("what segment would this member be in?").
export {
  recalculateSegments,
  computeSegment,
  type Segment,
} from "./segmentation";

// ─── Phase B: Cron scheduling ────────────────────────────────────────────────
// `startEmailCrons` is called once during server bootstrap. `listEmailCrons`
// powers the /api/email/status response so we can see what's scheduled.
// `runSegmentationNow` exists for the manual-trigger admin endpoint.
export {
  startEmailCrons,
  stopEmailCrons,
  listEmailCrons,
  runSegmentationNow,
  runFounderDigestNow,
} from "./cron";

// ─── Phase B: SendGrid Event Webhook ─────────────────────────────────────────
// Express handler for POST /api/email/webhook. Performs Ed25519 signature
// verification, normalizes the payload, and applies bounce/unsubscribe/spam
// logic. `verifyWebhookSignature` is exported for testability.
export {
  handleSendGridWebhook,
  verifyWebhookSignature,
} from "./webhook";

// ─── Phase B.5: Deactivations dashboard + Founder digest ────────────────────
export {
  listDeactivations,
  buildDigestSummary,
  restoreMember,
  recomputeDonors,
  categorizeReason,
  type DeactivationRow,
  type DigestSummary,
  type ListFilters as DeactivationListFilters,
} from "./deactivations";
export {
  sendFounderDigest,
  renderFounderDigest,
} from "./founder-digest";
export {
  buildFounderDigestHtml,
  buildFounderDigestSubject,
} from "./templates/founder-digest";
