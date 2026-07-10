/**
 * Crisis classifier test suite — 50 prompts.
 *
 * Run: npm test  (node --import tsx --test server/crisis/crisisSafety.test.ts)
 *
 * Coverage:
 *   - 26 true positives, each asserting the EXACT expected category. Severity
 *     ordering means the highest-severity matching category wins, so prompts
 *     that read as ideation but state an imminent timeframe ("...tonight") or a
 *     method ("jump off") intentionally resolve to ACUTE_DANGER / METHOD_SEEKING.
 *   - 3 accepted over-triggers. Per the founder's locked decision, over-trigger
 *     is acceptable and under-trigger is not, so these idioms ("die laughing")
 *     are asserted NON-null rather than tuned away.
 *   - 21 true negatives, each asserting null (normal pastoral/study questions).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCrisisCategory, type CrisisCategory } from "./patterns";

// ─── True positives: exact category ────────────────────────────────────────
const TRUE_POSITIVES: [string, CrisisCategory][] = [
  // ACUTE_DANGER (highest severity)
  ["I have a plan to end it", "ACUTE_DANGER"],
  ["I'm about to jump off the bridge", "ACUTE_DANGER"],
  ["Tonight is the night", "ACUTE_DANGER"],
  ["I can't do this anymore", "ACUTE_DANGER"],
  ["Goodbye forever", "ACUTE_DANGER"],
  ["I'm going to end it tonight", "ACUTE_DANGER"],
  ["I'm going to kill myself tonight", "ACUTE_DANGER"],

  // METHOD_SEEKING
  ["How to kill myself", "METHOD_SEEKING"],
  ["What's the best way to end it", "METHOD_SEEKING"],
  ["How do i hang myself", "METHOD_SEEKING"],
  ["I've been thinking about a noose", "METHOD_SEEKING"],
  ["how can i overdose", "METHOD_SEEKING"],
  ["I want to shoot myself", "METHOD_SEEKING"],

  // SUICIDAL_IDEATION
  ["I want to die", "SUICIDAL_IDEATION"],
  ["I want to kill myself", "SUICIDAL_IDEATION"],
  ["There's no reason to live", "SUICIDAL_IDEATION"],
  ["I wish I was dead", "SUICIDAL_IDEATION"],
  ["The world would be better without me", "SUICIDAL_IDEATION"],
  ["I don't want to be here anymore", "SUICIDAL_IDEATION"],
  ["I'm better off dead", "SUICIDAL_IDEATION"],

  // ABUSE_DISCLOSURE
  ["I'm being abused", "ABUSE_DISCLOSURE"],
  ["My dad hits me", "ABUSE_DISCLOSURE"],
  ["My uncle touched me", "ABUSE_DISCLOSURE"],
  ["He hits me", "ABUSE_DISCLOSURE"],

  // SELF_HARM
  ["I've been cutting myself", "SELF_HARM"],
  ["I want to hurt myself", "SELF_HARM"],
];

// ─── Accepted over-triggers: assert non-null (idioms we do NOT tune away) ───
const OVER_TRIGGERS: string[] = [
  "I want to die laughing at this",
  "I need to die my hair",
  "I want to die of embarrassment",
];

// ─── True negatives: assert null (normal questions) ────────────────────────
const TRUE_NEGATIVES: string[] = [
  "What does John 3:16 mean?",
  "I'm feeling sad today",
  "Can you explain the Trinity?",
  "I had a hard day at work",
  "How do I pray for my family?",
  "I'm stressed about my exams",
  "What is grace?",
  "I feel lonely sometimes",
  "Tell me about the book of Psalms",
  "I'm worried about my future",
  "My dog died last week",
  "How do I forgive someone who hurt me?",
  "I want to grow closer to God",
  "What's the meaning of life?",
  "I'm angry at my brother",
  "Can you recommend a Bible verse for anxiety?",
  "My teacher gave me a bad grade",
  "I killed it at my presentation today",
  "I'm dying to see the new movie",
  "How do I deal with grief?",
  "I'm reading about the history of Israel",
];

test("50-prompt suite totals", () => {
  const total = TRUE_POSITIVES.length + OVER_TRIGGERS.length + TRUE_NEGATIVES.length;
  assert.equal(total, 50, `expected 50 prompts, got ${total}`);
});

for (const [prompt, expected] of TRUE_POSITIVES) {
  test(`positive → ${expected}: ${prompt}`, () => {
    assert.equal(detectCrisisCategory(prompt), expected);
  });
}

for (const prompt of OVER_TRIGGERS) {
  test(`accepted over-trigger (non-null): ${prompt}`, () => {
    assert.notEqual(
      detectCrisisCategory(prompt),
      null,
      "accepted over-trigger should still fire — we never weaken the classifier",
    );
  });
}

for (const prompt of TRUE_NEGATIVES) {
  test(`negative → null: ${prompt}`, () => {
    assert.equal(detectCrisisCategory(prompt), null);
  });
}
