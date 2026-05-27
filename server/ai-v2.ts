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
 *   1. Model is Claude Sonnet 4.5 via Anthropic SDK. Pinned via env var
 *      ANTHROPIC_MODEL so future model bumps don't require a code change.
 *   2. Question-led prompt — the user's question is the primary signal,
 *      and the topic chip (if any) is downgraded to soft hint metadata.
 *      This is what fixes the "canned response from a category" problem.
 *   3. Multi-citation output — answer comes first, then 1–4 supporting
 *      passages. Each citation is its own object so the frontend can
 *      render drill-down per passage.
 *   4. STRICT JSON output via Anthropic's tool-use forcing. We do not
 *      rely on the model emitting valid JSON in free text. A schema-shaped
 *      tool call guarantees structure.
 *   5. KJV-only at the prompt layer. Stage B (a later PR) adds real RAG
 *      grounding against a KJV corpus; this stage relies on Sonnet's
 *      training-data recall of the KJV plus an explicit instruction
 *      to never fabricate references.
 */
import Anthropic from "@anthropic-ai/sdk";

// ─── Client + config ──────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

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

// ─── Tool schema (forces structured output) ───────────────────────────

const ANSWER_TOOL = {
  name: "deliver_pastoral_answer",
  description:
    "Deliver a pastoral answer to the user, grounded in supporting KJV passages with explanations of relevance, plus follow-up question suggestions.",
  input_schema: {
    type: "object" as const,
    properties: {
      answer: {
        type: "string",
        description:
          "2–5 sentence pastoral answer that engages the user's specific situation. Direct, warm, second-person. Not a sermon.",
      },
      citations: {
        type: "array",
        minItems: 1,
        maxItems: 4,
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
        },
      },
      followUps: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "string",
          description:
            "A short follow-up question (4–10 words) phrased as an actual question the user might ask next.",
        },
      },
    },
    required: ["answer", "citations", "followUps"],
  },
};

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

OUTPUT: Use the deliver_pastoral_answer tool. Do not respond in free text.`;

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

async function callAnthropic(userMessage: string): Promise<AskResponse> {
  const response = await anthropic!.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [ANSWER_TOOL],
    tool_choice: { type: "tool", name: ANSWER_TOOL.name },
    messages: [{ role: "user", content: userMessage }],
  });

  // Find the tool_use block. With tool_choice forcing a specific tool,
  // Anthropic will return exactly one tool_use block.
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Anthropic returned no tool_use block");
  }

  const parsed = toolUse.input as Partial<AskResponse>;
  validateResponse(parsed);
  return parsed as AskResponse;
}

function validateResponse(r: Partial<AskResponse>): asserts r is AskResponse {
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
