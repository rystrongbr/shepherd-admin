/**
 * Email module — data repository layer.
 *
 * This is the ONLY file in server/email/ that imports from server/storage.ts.
 * Every other email module file goes through `data.*` for persistence.
 *
 * Why this matters: when we extract the email module to its own service
 * (Option 3 in the README's Extraction Playbook), this file is the only one
 * that has to change — it becomes an HTTP client against the admin service.
 * The rest of the module continues to call `data.getChurch(id)` exactly the
 * same way, swap in / swap out, done.
 *
 * If you find yourself reaching into `storage` from anywhere else in this
 * folder, stop — add the method here instead.
 */

import { storage } from "../storage";
import type {
  Church,
  Member,
  Campaign,
  InsertActivity,
  BibleTopicContent,
  InsertBibleTopicContent,
  SequenceEnrollment,
  InsertSequenceEnrollment,
  EmailEvent,
  InsertEmailEvent,
  InsertMember,
  InsertChurch,
} from "@shared/schema";

export const data = {
  // ─── Churches ─────────────────────────────────────────────────────────────
  getChurch: (id: number): Church | undefined => storage.getChurch(id),

  updateChurch: (id: number, patch: Partial<InsertChurch>): Church | undefined =>
    storage.updateChurch(id, patch),

  // ─── Members ──────────────────────────────────────────────────────────────
  getMembers: (churchId: number): Member[] => storage.getMembers(churchId),
  getMember: (id: number): Member | undefined => storage.getMember(id),
  getMemberByEmail: (email: string): Member | undefined => storage.getMemberByEmail(email),
  getMemberBySendgridContactId: (contactId: string): Member | undefined =>
    storage.getMemberBySendgridContactId(contactId),

  updateMember: (id: number, patch: Partial<InsertMember>): Member | undefined =>
    storage.updateMember(id, patch),

  // ─── Campaigns ────────────────────────────────────────────────────────────
  getCampaign: (id: number): Campaign | undefined => storage.getCampaign(id),
  updateCampaign: (id: number, patch: Partial<Campaign>): Campaign | undefined =>
    // storage.updateCampaign is typed Partial<InsertCampaign> but accepts any subset
    storage.updateCampaign(id, patch as any),

  // ─── Activity feed ────────────────────────────────────────────────────────
  recordActivity: (data: InsertActivity) => storage.createActivity(data),

  // ─── Bible topic content (rotation library) ───────────────────────────────
  getBibleTopicContent: (activeOnly = true): BibleTopicContent[] =>
    storage.getBibleTopicContent(activeOnly),

  getNextRotationTopic: (): BibleTopicContent | undefined =>
    storage.getNextRotationTopic(),

  upsertBibleTopicContent: (input: InsertBibleTopicContent): BibleTopicContent =>
    storage.upsertBibleTopicContent(input),

  bumpRotationOrder: (id: number): void => storage.bumpRotationOrder(id),

  // ─── Sequence enrollments ─────────────────────────────────────────────────
  getEnrollment: (memberId: number, sequenceType: string): SequenceEnrollment | undefined =>
    storage.getEnrollment(memberId, sequenceType),

  createEnrollment: (input: InsertSequenceEnrollment): SequenceEnrollment =>
    storage.createEnrollment(input),

  updateEnrollment: (id: number, patch: Partial<InsertSequenceEnrollment>): SequenceEnrollment | undefined =>
    storage.updateEnrollment(id, patch),

  listActiveEnrollmentsDue: (sequenceType: string, sinceIso: string): SequenceEnrollment[] =>
    storage.listActiveEnrollmentsDue(sequenceType, sinceIso),

  // ─── Email events (webhook log) ───────────────────────────────────────────
  recordEmailEvent: (input: InsertEmailEvent): EmailEvent => storage.recordEmailEvent(input),

  // ─── Phase B — segmentation + webhook handler support ────────────────────
  getAllMembers: (): Member[] => storage.getAllMembers(),
  incrementBounceCount: (memberId: number): number => storage.incrementBounceCount(memberId),
  getCompletedDonationCountByEmail: (email: string): number =>
    storage.getCompletedDonationCountByEmail(email),
  getLastEngagementForMember: (memberId: number): string | undefined =>
    storage.getLastEngagementForMember(memberId),
};

export type EmailData = typeof data;
