/**
 * Email module — Deactivations (Phase B.5).
 *
 * Business-logic layer for the internal founder dashboard and the daily
 * founder digest. Sits between `data.ts` (raw queries) and the routes /
 * email-composition layers.
 *
 * Why split this out:
 *   - Both the dashboard endpoint and the digest job need the same "give me
 *     deactivated members with church context" query. Putting that here
 *     keeps it canonical.
 *   - The Restore action has policy (never override an honest unsubscribe)
 *     that has to live in code, not at the storage layer.
 *
 * Per the four discipline rules: this file only imports `./data`, `./config`,
 * `./logger`, `./contacts`, and `@shared/schema`. It never reaches into
 * `../storage` directly.
 */

import { data } from "./data";
import { emailConfig } from "./config";
import { logger } from "./logger";
import { syncMember } from "./contacts";
import type { Member, Church } from "@shared/schema";
import type { SendGridConfig } from "./types";

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * A deactivated member enriched with church context, in the shape the
 * dashboard + digest both consume.
 */
export interface DeactivationRow {
  memberId: number;
  email: string;
  firstName: string;
  lastName: string;
  churchId: number;
  churchName: string;
  reason: string;
  deactivatedAt: string;
  /**
   * Categorized reason for the digest's "by reason" rollup. Best-effort
   * parse of the free-text reason string the webhook recorded.
   */
  reasonCategory: "hard_bounce" | "soft_bounce" | "unsubscribe" | "spam_report" | "other";
  /** True if the member also has unsubscribedAt set — Restore handles this specially. */
  hasUnsubscribe: boolean;
  isDonor: boolean;
  donorSince: string;
  bounceCount: number;
}

export interface DigestSummary {
  /** "yesterday" window covered by this digest: [fromIso, toIso). */
  windowFromIso: string;
  windowToIso: string;
  /** Newly deactivated in the window. */
  newDeactivations: DeactivationRow[];
  /** Currently-active deactivations across all time (cumulative backlog). */
  totalDeactivated: number;
  /** Rollup of newDeactivations by reasonCategory. */
  byReason: Record<DeactivationRow["reasonCategory"], number>;
  /** Donors among newDeactivations — these are the highest-priority reviews. */
  donorDeactivations: DeactivationRow[];
  /** Anonymous crisis-safety signal counts in the window (category only). */
  crisisSignals: CrisisSignalSummary;
}

/**
 * Anonymous rollup of crisis-safety signals fired in the digest window.
 * Counts by category ONLY — no message content is ever stored or surfaced.
 */
export interface CrisisSignalSummary {
  total: number;
  byCategory: { category: string; count: number }[];
  /** True if any ACUTE_DANGER or METHOD_SEEKING fired — warrants follow-up review. */
  hasHighUrgency: boolean;
}

export interface RestoreResult {
  ok: true;
  memberId: number;
  email: string;
  resyncedToSendgrid: boolean;
}

export interface RestoreError {
  ok: false;
  reason: "not_found" | "not_deactivated" | "restore_disabled" | "sync_failed";
  detail?: string;
}

// ─── Reason categorization ───────────────────────────────────────────────────

/**
 * The webhook records reasons as free text like:
 *   - "hard bounce x1 (mailbox full)"
 *   - "soft bounce x3 (timeout)"
 *   - "unsubscribe"
 *   - "group_unsubscribe"
 *   - "spam_report"
 *
 * Parse that back into a category for digest rollups. Best-effort — anything
 * we don't recognize falls into "other" so a future reason string doesn't
 * crash the digest.
 */
export function categorizeReason(reason: string): DeactivationRow["reasonCategory"] {
  const r = (reason || "").toLowerCase();
  if (r.startsWith("hard")) return "hard_bounce";
  if (r.startsWith("soft")) return "soft_bounce";
  if (r.includes("spam")) return "spam_report";
  if (r.includes("unsubscribe")) return "unsubscribe";
  return "other";
}

// ─── Row enrichment ──────────────────────────────────────────────────────────

function enrich(member: Member, churchById: Map<number, Church>): DeactivationRow {
  const church = churchById.get(member.churchId);
  return {
    memberId: member.id,
    email: member.email,
    firstName: member.firstName,
    lastName: member.lastName,
    churchId: member.churchId,
    churchName: church?.name ?? `Unknown church #${member.churchId}`,
    reason: member.deactivationReason,
    deactivatedAt: member.deactivatedAt,
    reasonCategory: categorizeReason(member.deactivationReason),
    hasUnsubscribe: !!member.unsubscribedAt,
    isDonor: member.isDonor === 1,
    donorSince: member.donorSince,
    bounceCount: member.bounceCount,
  };
}

function loadChurchMap(memberRows: Member[]): Map<number, Church> {
  const ids = Array.from(new Set(memberRows.map((m) => m.churchId)));
  const map = new Map<number, Church>();
  for (const id of ids) {
    const c = data.getChurch(id);
    if (c) map.set(id, c);
  }
  return map;
}

// ─── List / filter ───────────────────────────────────────────────────────────

export interface ListFilters {
  /** Filter: only rows with deactivatedAt >= this ISO string. Empty = all time. */
  sinceIso?: string;
  /** Filter to a single reason category. Omit to return all. */
  reasonCategory?: DeactivationRow["reasonCategory"];
  /** Filter to donors only — these are the highest-priority review rows. */
  donorsOnly?: boolean;
  /** Max rows returned (default 200). */
  limit?: number;
}

export function listDeactivations(filters: ListFilters = {}): DeactivationRow[] {
  const since = filters.sinceIso || "";
  const raw = data.listDeactivatedMembers(since);
  const churchById = loadChurchMap(raw);
  let rows = raw.map((m) => enrich(m, churchById));
  if (filters.reasonCategory) {
    rows = rows.filter((r) => r.reasonCategory === filters.reasonCategory);
  }
  if (filters.donorsOnly) {
    rows = rows.filter((r) => r.isDonor);
  }
  const limit = filters.limit ?? 200;
  return rows.slice(0, limit);
}

// ─── Digest summary builder ──────────────────────────────────────────────────

/**
 * Build the data structure the founder digest email renders. Window defaults
 * to the prior 24 hours.
 */
export function buildDigestSummary(now: Date = new Date()): DigestSummary {
  const windowToIso = now.toISOString();
  const windowFromIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const recentRaw = data.listDeactivatedMembers(windowFromIso);
  // Filter to events strictly before "now" — list returns everything >= from.
  const inWindow = recentRaw.filter(
    (m) => m.deactivatedAt >= windowFromIso && m.deactivatedAt < windowToIso,
  );
  const churchById = loadChurchMap(inWindow);
  const newDeactivations = inWindow.map((m) => enrich(m, churchById));

  const byReason: DigestSummary["byReason"] = {
    hard_bounce: 0,
    soft_bounce: 0,
    unsubscribe: 0,
    spam_report: 0,
    other: 0,
  };
  for (const row of newDeactivations) {
    byReason[row.reasonCategory]++;
  }

  // Cumulative backlog = everything currently deactivated, regardless of when.
  const totalDeactivated = data.listDeactivatedMembers("").length;

  return {
    windowFromIso,
    windowToIso,
    newDeactivations,
    totalDeactivated,
    byReason,
    donorDeactivations: newDeactivations.filter((r) => r.isDonor),
    crisisSignals: buildCrisisSignalSummary(windowFromIso, windowToIso),
  };
}

/**
 * Roll up anonymous crisis-safety signals for the window. Counts by category
 * only. NO message content is stored anywhere, so none can be surfaced here.
 */
export function buildCrisisSignalSummary(fromIso: string, toIso: string): CrisisSignalSummary {
  const rows = data.getCrisisSignalCounts(fromIso, toIso);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const byCategory = [...rows].sort((a, b) => b.count - a.count);
  const hasHighUrgency = rows.some(
    (r) => (r.category === "ACUTE_DANGER" || r.category === "METHOD_SEEKING") && r.count > 0,
  );
  return { total, byCategory, hasHighUrgency };
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Restore a deactivated member: clears deactivatedAt + deactivationReason,
 * resets bounceCount, re-syncs the contact to SendGrid.
 *
 * Policy:
 *   - Gated by emailConfig.deactivationRestoreEnabled (env flag). Returns a
 *     structured error when off, so the dashboard can render a friendly
 *     "Restore not yet enabled" state.
 *   - NEVER clears unsubscribedAt when the deactivation reason was a real
 *     user unsubscribe. Honest unsubscribes stand. Spam reports DO get the
 *     unsubscribe cleared because the user might have just hit "junk" by
 *     accident.
 *   - Re-sync to SendGrid is best-effort — DB clearance is the source of
 *     truth, sync failure is logged and reported but doesn't roll back.
 */
export async function restoreMember(
  memberId: number,
  note: string = "",
): Promise<RestoreResult | RestoreError> {
  if (!emailConfig.deactivationRestoreEnabled) {
    return { ok: false, reason: "restore_disabled" };
  }

  const member = data.getMember(memberId);
  if (!member) return { ok: false, reason: "not_found" };
  if (!member.deactivatedAt) return { ok: false, reason: "not_deactivated" };

  // Was this triggered by a real unsubscribe? If so, keep unsubscribedAt.
  const category = categorizeReason(member.deactivationReason);
  const clearUnsubscribe = category === "spam_report";

  const updated = data.restoreDeactivatedMember(memberId, clearUnsubscribe);
  if (!updated) return { ok: false, reason: "not_found" };

  logger.info("email.deactivations.restored", {
    memberId,
    email: member.email,
    category,
    clearedUnsubscribe: clearUnsubscribe,
    note,
  });

  data.recordActivity({
    churchId: member.churchId,
    type: "email_sent",
    description: `${member.firstName} ${member.lastName} restored by admin${note ? `: ${note}` : ""}`,
    createdAt: new Date().toISOString(),
    meta: JSON.stringify({
      memberId,
      action: "restore",
      previousReason: member.deactivationReason,
      clearedUnsubscribe: clearUnsubscribe,
      note,
    }),
  });

  // Best-effort SendGrid re-sync.
  let resyncedToSendgrid = false;
  const church = data.getChurch(member.churchId);
  if (church && church.sendgridApiKey && church.sendgridFromEmail) {
    try {
      const config: SendGridConfig = {
        apiKey: church.sendgridApiKey,
        fromEmail: church.sendgridFromEmail,
        fromName: church.name,
      };
      await syncMember(config, member.churchId, {
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        segment: updated.segment,
        phone: updated.phone,
        signupDate: updated.joinedAt,
        homeZip: updated.homeZip,
      });
      resyncedToSendgrid = true;
    } catch (err) {
      logger.warn("email.deactivations.restore.sync_failed", {
        memberId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        reason: "sync_failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    ok: true,
    memberId,
    email: updated.email,
    resyncedToSendgrid,
  };
}

// ─── Donor recompute (safety-net) ────────────────────────────────────────────

/**
 * Recompute is_donor + donor_since for every member. The donations flow
 * should mark donors at the moment the payment completes; this is the
 * nightly safety-net that catches any drift.
 */
export function recomputeDonors(): { updated: number; total: number } {
  const result = data.recomputeDonorFlags();
  logger.info("email.deactivations.donor_recompute", result);
  return result;
}
