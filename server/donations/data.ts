// Data access layer for the donations module.
// Wraps drizzle queries against chat_reactions, donation_prompts, and donations.
// Only this file (and webhook.ts for raw Stripe payloads) touches the tables directly.

import { db } from "../storage";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import {
  chatReactions,
  donationPrompts,
  donations,
  chats,
  appUsers,
  type ChatReaction,
  type DonationPrompt,
  type Donation,
  type InsertChatReaction,
  type InsertDonationPrompt,
  type InsertDonation,
} from "@shared/schema";

// ─── Chat reactions ──────────────────────────────────────────────────────────

export function recordReaction(data: InsertChatReaction): ChatReaction {
  return db.insert(chatReactions).values(data).returning().get();
}

export function getReactionForChat(userId: number, chatId: number): ChatReaction | undefined {
  return db.select().from(chatReactions)
    .where(and(eq(chatReactions.userId, userId), eq(chatReactions.chatId, chatId)))
    .get();
}

export function getUserHelpedReactionsSince(userId: number, sinceIso: string): ChatReaction[] {
  return db.select().from(chatReactions)
    .where(and(
      eq(chatReactions.userId, userId),
      eq(chatReactions.reaction, "helped"),
      gte(chatReactions.createdAt, sinceIso),
    ))
    .all();
}

// ─── Donation prompts ────────────────────────────────────────────────────────

export function logPrompt(data: InsertDonationPrompt): DonationPrompt {
  return db.insert(donationPrompts).values(data).returning().get();
}

export function updatePromptOutcome(id: number, outcome: string): void {
  db.update(donationPrompts)
    .set({ outcome, outcomeAt: new Date().toISOString() })
    .where(eq(donationPrompts.id, id))
    .run();
}

export function getUserPrompts(userId: number, limit = 20): DonationPrompt[] {
  return db.select().from(donationPrompts)
    .where(eq(donationPrompts.userId, userId))
    .orderBy(desc(donationPrompts.shownAt))
    .limit(limit)
    .all();
}

export function getLastPrompt(userId: number): DonationPrompt | undefined {
  return db.select().from(donationPrompts)
    .where(eq(donationPrompts.userId, userId))
    .orderBy(desc(donationPrompts.shownAt))
    .limit(1)
    .get();
}

export function countConsecutiveMaybeLater(userId: number): number {
  // Most-recent N prompts in reverse-chrono; count from top while outcome === 'maybe_later'
  const recent = db.select().from(donationPrompts)
    .where(eq(donationPrompts.userId, userId))
    .orderBy(desc(donationPrompts.shownAt))
    .limit(10)
    .all();
  let n = 0;
  for (const p of recent) {
    if (p.outcome === "maybe_later") n++;
    else break;
  }
  return n;
}

export function hasOptedOut(userId: number): boolean {
  const optOut = db.select().from(donationPrompts)
    .where(and(eq(donationPrompts.userId, userId), eq(donationPrompts.outcome, "opt_out")))
    .limit(1)
    .get();
  return !!optOut;
}

// ─── Donations ───────────────────────────────────────────────────────────────

export function createDonation(data: InsertDonation): Donation {
  return db.insert(donations).values(data).returning().get();
}

export function getDonationBySessionId(stripeSessionId: string): Donation | undefined {
  return db.select().from(donations)
    .where(eq(donations.stripeSessionId, stripeSessionId))
    .get();
}

export function markDonationCompleted(stripeSessionId: string, paymentIntentId: string, email: string): void {
  db.update(donations)
    .set({
      status: "completed",
      stripePaymentIntentId: paymentIntentId,
      email: email,
      completedAt: new Date().toISOString(),
    })
    .where(eq(donations.stripeSessionId, stripeSessionId))
    .run();
}

export function getUserCompletedDonationsSince(userId: number, sinceIso: string): Donation[] {
  return db.select().from(donations)
    .where(and(
      eq(donations.userId, userId),
      eq(donations.status, "completed"),
      gte(donations.completedAt, sinceIso),
    ))
    .all();
}

export function getUserDonationCount(userId: number): number {
  const row = db.select({ count: sql<number>`COUNT(*)` }).from(donations)
    .where(and(eq(donations.userId, userId), eq(donations.status, "completed")))
    .get();
  return row?.count ?? 0;
}

// ─── User context helpers (cross-table for eligibility) ──────────────────────

export function getUserChatCount(userId: number): number {
  const row = db.select({ count: sql<number>`COUNT(*)` }).from(chats)
    .where(eq(chats.userId, userId))
    .get();
  return row?.count ?? 0;
}

export function getUserAccountAgeDays(userId: number): number {
  const user = db.select().from(appUsers).where(eq(appUsers.id, userId)).get();
  if (!user) return 0;
  const created = new Date(user.createdAt).getTime();
  return (Date.now() - created) / (1000 * 60 * 60 * 24);
}
