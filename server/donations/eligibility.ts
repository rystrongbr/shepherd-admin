// Donation prompt eligibility logic.
// Encodes the cadence rules from my_shepherd_gtm_plan.md (Part 3):
//
//   1. Account age >= 7 days
//   2. >= 3 distinct chats completed
//   3. At least one positive signal in last 7 days (a 'helped' reaction)
//   4. No prompt shown in last 14 days
//   5. No completed donation in last 30 days
//   6. User has not opted out
//   7. If they hit 3 consecutive 'maybe_later' dismissals, pause 60 days
//
// Returns a structured result so the frontend can explain WHY a prompt isn't
// showing (useful for QA and for support requests like "why am I being asked?").

import * as data from "./data";

export type EligibilityReason =
  | "eligible"
  | "account_too_new"
  | "not_enough_chats"
  | "no_value_signal"
  | "prompt_cooldown"
  | "recent_donation"
  | "opted_out"
  | "maybe_later_pause";

export interface EligibilityResult {
  eligible: boolean;
  reason: EligibilityReason;
  // For debugging / support
  diagnostics: {
    accountAgeDays: number;
    chatCount: number;
    helpedReactionsLast7Days: number;
    daysSinceLastPrompt: number | null;
    daysSinceLastDonation: number | null;
    consecutiveMaybeLater: number;
  };
}

const MIN_ACCOUNT_AGE_DAYS = 7;
const MIN_CHAT_COUNT = 3;
const PROMPT_COOLDOWN_DAYS = 14;
const DONATION_COOLDOWN_DAYS = 30;
const VALUE_SIGNAL_WINDOW_DAYS = 7;
const MAYBE_LATER_PAUSE_DAYS = 60;
const MAYBE_LATER_THRESHOLD = 3;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

export function checkEligibility(userId: number): EligibilityResult {
  // Gather diagnostics first so we can return them with whatever decision.
  const accountAgeDays = data.getUserAccountAgeDays(userId);
  const chatCount = data.getUserChatCount(userId);
  const helped = data.getUserHelpedReactionsSince(userId, daysAgo(VALUE_SIGNAL_WINDOW_DAYS));
  const lastPrompt = data.getLastPrompt(userId);
  const recentDonations = data.getUserCompletedDonationsSince(userId, daysAgo(DONATION_COOLDOWN_DAYS));
  const optedOut = data.hasOptedOut(userId);
  const consecutiveMaybeLater = data.countConsecutiveMaybeLater(userId);

  const daysSinceLastPrompt = lastPrompt
    ? (Date.now() - new Date(lastPrompt.shownAt).getTime()) / (1000 * 60 * 60 * 24)
    : null;
  const daysSinceLastDonation = recentDonations.length > 0
    ? (Date.now() - new Date(recentDonations[0].completedAt).getTime()) / (1000 * 60 * 60 * 24)
    : null;

  const diagnostics = {
    accountAgeDays: Math.floor(accountAgeDays),
    chatCount,
    helpedReactionsLast7Days: helped.length,
    daysSinceLastPrompt: daysSinceLastPrompt !== null ? Math.floor(daysSinceLastPrompt) : null,
    daysSinceLastDonation: daysSinceLastDonation !== null ? Math.floor(daysSinceLastDonation) : null,
    consecutiveMaybeLater,
  };

  // Run the gates in order.
  if (optedOut) {
    return { eligible: false, reason: "opted_out", diagnostics };
  }

  if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
    return { eligible: false, reason: "account_too_new", diagnostics };
  }

  if (chatCount < MIN_CHAT_COUNT) {
    return { eligible: false, reason: "not_enough_chats", diagnostics };
  }

  if (helped.length === 0) {
    return { eligible: false, reason: "no_value_signal", diagnostics };
  }

  if (recentDonations.length > 0) {
    return { eligible: false, reason: "recent_donation", diagnostics };
  }

  // 3-strikes-then-pause rule: if last 3 prompts were all maybe_later AND
  // the most recent of those was within the 60-day pause window, suppress.
  if (consecutiveMaybeLater >= MAYBE_LATER_THRESHOLD && lastPrompt) {
    const daysSinceLast = (Date.now() - new Date(lastPrompt.shownAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLast < MAYBE_LATER_PAUSE_DAYS) {
      return { eligible: false, reason: "maybe_later_pause", diagnostics };
    }
  }

  if (lastPrompt) {
    const daysSinceLast = (Date.now() - new Date(lastPrompt.shownAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLast < PROMPT_COOLDOWN_DAYS) {
      return { eligible: false, reason: "prompt_cooldown", diagnostics };
    }
  }

  return { eligible: true, reason: "eligible", diagnostics };
}
