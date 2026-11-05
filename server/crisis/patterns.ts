/**
 * Crisis pattern library.
 *
 * Regex-only classifier (v1). Grouped by category so we can log the category
 * WITHOUT storing any message content. All patterns are case-insensitive and
 * ordered by specificity within a category.
 *
 * Design principle (locked by the founder): over-triggering is acceptable;
 * under-triggering is not. The cost of a missed crisis is asymmetrically
 * higher than the cost of an unnecessary safety message. Do NOT weaken these
 * patterns to reduce false positives.
 *
 * Why regex first (not an LLM classifier):
 *   - Zero added latency on every message
 *   - Zero per-message cost
 *   - Deterministic, testable, reviewable
 *   - Covers 95%+ of obvious crisis language
 * A feature-flagged Claude Haiku edge-case classifier is a future v2 (out of
 * scope for this build).
 */

export type CrisisCategory =
  | "SUICIDAL_IDEATION"
  | "SELF_HARM"
  | "METHOD_SEEKING"
  | "ACUTE_DANGER"
  | "DOMESTIC_VIOLENCE"
  | "ABUSE_DISCLOSURE";

const SUICIDAL_IDEATION: RegExp[] = [
  /\b(i\s+want\s+to|i\s+wanna|i\s+need\s+to|i\s+should|i\s+will|i'?m\s+going\s+to)\s+(die|kill\s+myself|end\s+(it|my\s+life)|not\s+be\s+here|be\s+dead)\b/i,
  /\b(kill(ing)?\s+myself|end\s+(it\s+all|my\s+life)|take\s+my\s+(own\s+)?life|off\s+myself|suicid(e|al))\b/i,
  /\b(no\s+reason\s+to\s+live|nothing\s+to\s+live\s+for|better\s+off\s+dead|world\s+would\s+be\s+better\s+without\s+me|don'?t\s+want\s+to\s+(be\s+here|live|exist))\b/i,
  /\b(want\s+to\s+die|wish\s+i\s+(was|were)\s+dead|wish\s+i\s+didn'?t\s+exist)\b/i,
  // "I don't want to be alive anymore", "I do not want to wake up", "dont wanna live"
  /\b(don'?t|do\s+not)\s+(want\s+to|wanna)\s+(be\s+alive|live|wake\s+up|go\s+on|exist|be\s+here)\b/i,
  /\bwish\s+i\s+(was|were|had)\s+never\s+(been\s+)?born\b/i,
  /\b(tired|sick)\s+of\s+(living|being\s+alive)\b/i,
  /\bno\s+point\s+(in\s+)?(living|being\s+alive|going\s+on)\b/i,
  /\bcan'?t\s+go\s+on\s+(living|anymore)\b/i,
  /\bwant\s+(my\s+life\s+to\s+(end|be\s+over)|to\s+disappear\s+forever)\b/i,
];

const SELF_HARM: RegExp[] = [
  /\b(cut(ting)?\s+myself|hurt(ing)?\s+myself|harm(ing)?\s+myself|self[-\s]?harm)\b/i,
  /\b(want\s+to|going\s+to)\s+(hurt|cut|harm)\s+myself\b/i,
];

const METHOD_SEEKING: RegExp[] = [
  /\b(how\s+(to|do\s+i|can\s+i)|what'?s\s+the\s+best\s+way\s+to)\s+(kill\s+myself|end\s+(it|my\s+life)|hang\s+myself|overdose|die|tie\s+a\s+noose)\b/i,
  /\b(noose|hanging|overdose|pills\s+to\s+die|jump\s+off|shoot\s+myself)\b/i,
];

const ACUTE_DANGER: RegExp[] = [
  /\b(i\s+have\s+a\s+plan|i'?m\s+about\s+to|tonight\s+is\s+the\s+night|i\s+can'?t\s+do\s+this\s+anymore|goodbye\s+forever)\b/i,
  // Imminent-timeframe intent ("...end it tonight", "...do it tonight"). A stated
  // tonight/right-now timeframe escalates ideation to acute danger, so this is
  // ordered into ACUTE_DANGER (highest severity) on purpose.
  /\b(end\s+(it|my\s+life)|do\s+it|kill\s+myself)\s+(tonight|right\s+now|today)\b/i,
];

// Partner / spouse violence. Separate from ABUSE_DISCLOSURE so adults get the
// National Domestic Violence Hotline instead of the child-abuse hotline.
const PARTNER = "(husband|wife|boyfriend|girlfriend|partner|fianc[eé]e?|spouse|ex[-\\s]?(husband|wife|boyfriend|girlfriend)|ex)";
const DOMESTIC_VIOLENCE: RegExp[] = [
  new RegExp(`\\b(my\\s+)?${PARTNER}\\s+(hits|hit|beats|beat|chokes|choked|strangles|strangled|slaps|slapped|punches|punched|kicks|kicked|shoves|shoved|hurts|abuses|abused|rapes|raped)\\s+me\\b`, "i"),
  new RegExp(`\\b(my\\s+)?${PARTNER}\\s+(is|was|has\\s+been|keeps)\\s+(abusive|violent|abusing\\s+me|hitting\\s+me|beating\\s+me|choking\\s+me)\\b`, "i"),
  new RegExp(`\\b(abusive|violent)\\s+(marriage|relationship|home|${PARTNER})\\b`, "i"),
  new RegExp(`\\b(he|she|they|my\\s+${PARTNER})\\s+(chokes|choked|strangles|strangled|beats|beat)\\s+me\\b`, "i"),
  new RegExp(`\\b(afraid|scared|terrified)\\s+(that\\s+)?(he|she|they|my\\s+${PARTNER})\\s+(will|is\\s+going\\s+to|might|could)\\s+(kill|hurt)\\s+me\\b`, "i"),
  new RegExp(`\\b(he|she|they|my\\s+${PARTNER})\\s+threaten(s|ed)?\\s+to\\s+kill\\s+me\\b`, "i"),
];

const ABUSE_DISCLOSURE: RegExp[] = [
  /\b(being\s+abused|he\s+hits\s+me|she\s+hits\s+me|they\s+hit\s+me|(my\s+)?(dad|mom|father|mother|stepdad|stepmom|uncle|coach|teacher|pastor)\s+(hits|hurts|touches|touched|beats|rapes|raped)\s+me)\b/i,
  /\b(sexual(ly)?\s+(abus|assault)|molest(ed|ing)?|rape[dn]?)\s+me\b/i,
];

export const categories: Record<CrisisCategory, RegExp[]> = {
  SUICIDAL_IDEATION,
  SELF_HARM,
  METHOD_SEEKING,
  ACUTE_DANGER,
  DOMESTIC_VIOLENCE,
  ABUSE_DISCLOSURE,
};

// Highest severity wins if multiple categories match. The classifier walks
// this order and returns the first category with a matching pattern.
export const severityOrder: CrisisCategory[] = [
  "ACUTE_DANGER",
  "METHOD_SEEKING",
  "SUICIDAL_IDEATION",
  "DOMESTIC_VIOLENCE",
  "ABUSE_DISCLOSURE",
  "SELF_HARM",
];

/**
 * iPhone keyboards insert curly apostrophes ("don’t", "I’m") by default, which
 * the plain-apostrophe patterns would miss. Normalize them (and collapse runs
 * of whitespace) before matching. The original message is never modified.
 */
export function normalizeForMatching(message: string): string {
  return message.replace(/[\u2018\u2019\u02BC\u2032\u0060\u00B4]/g, "'").replace(/\s+/g, " ");
}

/**
 * Returns the highest-severity crisis category whose pattern matches the
 * message, or null if none match. Never sees or retains the message beyond
 * this synchronous check.
 */
export function detectCrisisCategory(message: string): CrisisCategory | null {
  if (!message || typeof message !== "string") return null;
  const text = normalizeForMatching(message);
  for (const category of severityOrder) {
    for (const pattern of categories[category]) {
      if (pattern.test(text)) return category;
    }
  }
  return null;
}
