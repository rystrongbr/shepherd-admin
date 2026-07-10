/**
 * Crisis safety module — PUBLIC INTERFACE.
 *
 * The crisis-safety response intercepts crisis language before any LLM call,
 * routes the user to 988 / Crisis Text Line (or Childhelp + RAINN for abuse
 * disclosures), and logs an anonymous category-only signal. See the crisis
 * safety spec for the full rationale.
 */

export { crisisSafetyCheck } from "./middleware";
export { detectCrisisCategory, type CrisisCategory } from "./patterns";
export { buildCrisisResponse, type CrisisResponse } from "./response";
