/**
 * My Shepherd — Product 1 AI v2 (Sonnet, question-led, multi-citation)
 * ─────────────────────────────────────────────────────────────────────
 * This module is the Stage A upgrade to server/ai.ts. It is NOT a drop-in
 * replacement — the response shape is different on purpose (multi-citation
 * instead of single-verse) and the prompting style is question-led
 * (the user's actual situation drives the answer, not a topic category).
 *
 * The old `server/ai.ts` remains live as a fallback during the soft-launch
 * window. See the Stage A PR description for the cutover plan.
 *
 * Design choices (locked in by the product map):
 *   1. Model is pinned via env var ANTHROPIC_MODEL (default Sonnet 4.5,
 *      which retires 2026-11-30; production moves to claude-sonnet-5-5
 *      by changing the env var after the eval in scripts/ai-eval.ts).
 *   2. Question-led prompt — the user's question is the primary signal,
 *      and the topic chip (if any) is downgraded to soft hint metadata.
 *      This is what fixes the "canned response from a category" problem.
 *   3. Multi-citation output — answer comes first, then 1–4 supporting
 *      passages. Each citation is its own object so the frontend can
 *      render drill-down per passage.
 *   4. STRICT JSON output via Anthropic structured outputs
 *      (output_config.format = json_schema). Forced tool_choice is rejected
 *      by Sonnet 5.5, so we no longer use a forced tool call. Structured
 *      outputs work on both Sonnet 4.5 and 5.5, which lets us deploy this
 *      code before flipping the model.
 *   5. KJV-only at the prompt layer. Stage B (a later PR) adds real RAG
 *      grounding against a KJV corpus; this stage relies on Sonnet's
 *      training-data recall of the KJV plus an explicit instruction
 *      to never fabricate references.
 */
import Anthropic from "@anthropic-ai/sdk";

// ─── Client + config ──────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 6000;
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORT_LEVELS)[number];

/** Read at call time so tests and the eval script can override per run. */
export function aiConfig() {
  const model = (process.env.ANTHROPIC_MODEL || DEFAULT_MODEL).trim();
  const parsedMax = Number(process.env.ANTHROPIC_MAX_TOKENS);
  // Thinking tokens count toward max_tokens on models that think (Sonnet 5.5),
  // so the old 1500 cap could truncate answers.
  const maxTokens = Number.isFinite(parsedMax) && parsedMax >= 1000 ? Math.floor(parsedMax) : DEFAULT_MAX_TOKENS;
  const rawEffort = (process.env.ANTHROPIC_EFFORT || "").trim().toLowerCase();
  const effort = (EFFORT_LEVELS as readonly string[]).includes(rawEffort) ? (rawEffort as Effort) : undefined;
  return { model, maxTokens, effort };
}

type MessagesClient = Pick<Anthropic, "messages">;

let anthropic: MessagesClient | null = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

/** Test/eval hook: inject a client (or a fake). Not used by production routes. */
export function setAnthropicClient(client: MessagesClient | null) {
  anthropic = client;
}

export function isV2Configured(): boolean {
  return anthropic !== null;
}

// ─── Public response shape ────────────────────────────────────────────
//
// The frontend renders this. Keep it stable across minor backend changes;
// any shape change here is a frontend-visible breaking change.

export interface Citation {
  /** Canonical KJV reference, e.g. "Philippians 4:6-7" or "Matthew 18:21". */
  ref: string;
  /** Full KJV text of the cited passage(s), already joined into a paragraph. */
  text: string;
  /**
   * One sentence explaining HOW this specific passage answers the user's
   * question. Not a generic reflection — must be question-specific.
   */
  relevance: string;
}

export interface AskResponse {
  /**
   * Conversational, pastoral answer that actually engages the question.
   * 2–5 sentences. Speaks to the user directly ("you"). Draws on the
   * citations but doesn't merely list them.
   */
  answer: string;
  /** 1–4 supporting passages, ordered by how central they are to the answer. */
  citations: Citation[];
  /**
   * 3 short follow-up question suggestions the user might ask next, each
   * 4–10 words and phrased as actual questions (not category labels).
   */
  followUps: string[];
}

// ─── Answer schema (structured outputs) ───────────────────────────────
//
// Structured outputs support only a subset of JSON Schema: every object
// needs additionalProperties:false, and arrays allow minItems 0 or 1 only
// (no maxItems). Counts (1–4 citations, exactly 3 followUps) are enforced
// in validateResponse() below, and the prompt states them explicitly.

export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "2–5 sentence pastoral answer that engages the user's specific situation. Direct, warm, second-person. Not a sermon.",
    },
    citations: {
      type: "array",
      minItems: 1,
      description: "1 to 4 supporting KJV passages, most central first.",
      items: {
        type: "object",
        properties: {
          ref: {
            type: "string",
            description:
              "KJV reference in canonical form, e.g. 'Philippians 4:6-7'. Must be a real KJV passage; never fabricate.",
          },
          text: {
            type: "string",
            description:
              "Exact KJV text of the passage. No paraphrasing. Multiple consecutive verses joined into one paragraph is acceptable.",
          },
          relevance: {
            type: "string",
            description:
              "ONE sentence explaining how this specific passage answers the user's specific question. Not a generic reflection.",
          },
        },
        required: ["ref", "text", "relevance"],
        additionalProperties: false,
      },
    },
    followUps: {
      type: "array",
      description: "Exactly 3 short follow-up questions.",
      items: {
        type: "string",
        description:
          "A short follow-up question (4–10 words) phrased as an actual question the user might ask next.",
      },
    },
  },
  required: ["answer", "citations", "followUps"],
  additionalProperties: false,
} as const;

// ─── System prompt ────────────────────────────────────────────────────
//
// Notes on prompt design:
//  - We DO NOT ask for a "topic" or "category" framing. The user's
//    question is the only thing that matters. Any topic context the
//    caller passes is hint metadata at most.
//  - We explicitly forbid fabricated references. This is not a guarantee
//    (Stage B/RAG is the guarantee) but it is the strongest available
//    instruction at the prompt layer.
//  - The "speak to a real person" instructions are written from real
//    examples of canned, sermon-like responses we want to avoid.
//  - We allow Sonnet to say "Scripture doesn't directly address this"
//    when honest — this is critical for trust. Better to admit a gap
//    than fabricate a verse.

const SYSTEM_PROMPT = `You are My Shepherd, a thoughtful pastoral companion that helps people think about their lives and questions through the King James Version of the Bible.

CRITICAL RULES — read carefully, apply every time:

1. ENGAGE THE ACTUAL QUESTION. The person is not asking about a category like "anxiety" or "forgiveness" — they are asking about THEIR situation. Read their words carefully. If they mention their mother, their job, their grief, their doubt — speak to THAT, not to a generic version of it. Never give a response that could have been written without reading their actual question.

2. ANSWER FIRST, SCRIPTURE SUPPORTS. Lead with a real, human, pastoral answer to their question. Then cite the passages your answer draws from. Do not lead with "Here is a verse for you" — that is exactly the canned pattern to avoid.

3. KING JAMES VERSION ONLY, NO FABRICATION. Every citation must be a real, accurate KJV passage. If you are not confident a reference exists, do not include it. It is FAR better to cite fewer real passages than to invent one. If scripture does not directly address the situation, say so honestly in your answer and cite the closest applicable wisdom you can find.

4. MULTIPLE PASSAGES WHEN APPROPRIATE. Real pastoral wisdom often draws on multiple parts of scripture — a comfort passage, a challenging passage, a wisdom passage. Provide 1–4 citations as the question warrants. A simple question may need one; a complex question may need three or four. Do not pad with weak citations.

5. EACH CITATION'S 'relevance' FIELD IS QUESTION-SPECIFIC. Not a generic reflection. It should explain in one sentence WHY THIS PASSAGE in THIS situation. The same verse cited to two different people for two different reasons should have two different relevance sentences.

6. SECOND PERSON, WARM, NOT PREACHY. Speak to the person, not at them. "You are not alone in this" rather than "One must remember that we are not alone." No sermons. No "my child." No religious-sounding scaffolding.

7. FOLLOW-UPS ARE ACTUAL QUESTIONS. Three short questions the person might naturally ask next, in their own voice — not category labels. "How do I forgive when they aren't sorry?" is good. "Forgiveness" is bad.

OUTPUT: Respond only with the JSON object defined by the response schema: "answer", 1 to 4 "citations", and exactly 3 "followUps". No other text.`;

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Primary entry point. The caller passes the user's actual question;
 * topicHint (if any) is treated as soft context only — the prompt
 * intentionally does not anchor on it.
 */
export async function ask(params: {
  question: string;
  topicHint?: string;
}): Promise<AskResponse> {
  if (!anthropic) {
    throw new Error(
      "Anthropic client not configured — set ANTHROPIC_API_KEY in env",
    );
  }
  const question = (params.question || "").trim();
  if (!question) {
    throw new Error("question is required");
  }
  const topicHint = (params.topicHint || "").trim();

  // The user message is the question itself. Topic hint is appended as
  // metadata only, NOT as the headline — this is the structural fix for
  // the canned-response problem.
  const userMessage =
    topicHint && topicHint.length > 0
      ? `${question}\n\n(Optional context — the user clicked the "${topicHint}" suggestion before typing this. Treat as a hint only; the question above is what matters.)`
      : question;

  return callAnthropic(userMessage);
}

/**
 * Drill-down on a specific citation. The caller passes the original
 * question and the passage the user clicked on; we return a fresh
 * answer focused specifically on that passage in context of the question.
 */
export async function drillDown(params: {
  originalQuestion: string;
  passageRef: string;
}): Promise<AskResponse> {
  if (!anthropic) {
    throw new Error(
      "Anthropic client not configured — set ANTHROPIC_API_KEY in env",
    );
  }
  const question = (params.originalQuestion || "").trim();
  const ref = (params.passageRef || "").trim();
  if (!question || !ref) {
    throw new Error("originalQuestion and passageRef are required");
  }

  const userMessage = `The user originally asked: "${question}"

They want to go deeper specifically on ${ref}. Provide a focused answer that:
  - Explains what ${ref} is teaching, in its own context (who wrote it, who they were writing to, what was happening).
  - Connects that teaching back to the user's original situation.
  - Cites ${ref} as one of your citations, plus 1–2 closely related passages that illuminate it further.
  - Suggests follow-up questions that explore this passage further.`;

  return callAnthropic(userMessage);
}

// ─── Internal helpers ─────────────────────────────────────────────────

export class AiResponseError extends Error {}

async function callAnthropic(userMessage: string): Promise<AskResponse> {
  // One retry for a malformed/invalid answer (bad JSON, wrong counts,
  // truncated). API errors (rate limits, 5xx) are not retried here; the SDK
  // already retries those.
  try {
    return await requestAnswer(userMessage, 1);
  } catch (err) {
    if (!(err instanceof AiResponseError)) throw err;
    console.warn(`[ai-v2] invalid answer, retrying once: ${err.message}`);
    return await requestAnswer(userMessage, 2);
  }
}

async function requestAnswer(userMessage: string, attempt: number): Promise<AskResponse> {
  const { model, maxTokens, effort } = aiConfig();
  const started = Date.now();
  const response = await anthropic!.messages.create({
    model,
    max_tokens: maxTokens,
    // The system prompt is identical on every request; cache it.
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    output_config: {
      format: { type: "json_schema", schema: ANSWER_SCHEMA as unknown as Record<string, unknown> },
      ...(effort ? { effort } : {}),
    },
    messages: [{ role: "user", content: userMessage }],
  });

  logUsage(model, attempt, Date.now() - started, response);

  if (response.stop_reason === "max_tokens") {
    throw new AiResponseError(`answer truncated at max_tokens=${maxTokens}`);
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Anthropic refused to answer");
  }
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new AiResponseError("Anthropic returned no text block");
  }
  let parsed: Partial<AskResponse>;
  try {
    parsed = JSON.parse(textBlock.text) as Partial<AskResponse>;
  } catch {
    throw new AiResponseError("Anthropic returned invalid JSON");
  }
  try {
    validateResponse(parsed);
  } catch (err: any) {
    throw new AiResponseError(err?.message || "invalid answer");
  }
  return parsed;
}

/** Token + latency log line. Never includes the question or answer text. */
function logUsage(model: string, attempt: number, ms: number, response: any) {
  const u = response?.usage || {};
  const thinking = u.output_tokens_details?.thinking_tokens;
  console.log(
    `[ai-v2] usage model=${model} attempt=${attempt} ms=${ms} stop=${response?.stop_reason} ` +
      `in=${u.input_tokens ?? "?"} out=${u.output_tokens ?? "?"}` +
      (thinking !== undefined ? ` thinking=${thinking}` : "") +
      ` cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`,
  );
}

export function validateResponse(r: Partial<AskResponse>): asserts r is AskResponse {
  if (!r.answer || typeof r.answer !== "string") {
    throw new Error("AI response missing 'answer'");
  }
  if (!Array.isArray(r.citations) || r.citations.length === 0) {
    throw new Error("AI response missing 'citations'");
  }
  if (r.citations.length > 4) {
    throw new Error("AI returned too many citations (>4)");
  }
  for (let i = 0; i < r.citations.length; i++) {
    const c = r.citations[i];
    if (!c.ref || !c.text || !c.relevance) {
      throw new Error(`Citation ${i} is missing required fields`);
    }
  }
  if (!Array.isArray(r.followUps) || r.followUps.length !== 3) {
    throw new Error("AI response must have exactly 3 followUps");
  }
}
