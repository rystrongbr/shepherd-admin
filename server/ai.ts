import OpenAI from "openai";
import { canonicalText, isCanonicalKjvEnabled, loadCorpus, logGrounding } from "./kjv/canonical";

// OpenAI client — key stored in env var OPENAI_API_KEY
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are My Shepherd, a warm and thoughtful scripture companion built for people seeking comfort, guidance, and reflection through the Bible (King James Version).

When a user asks a question or selects a topic, you MUST respond in the following JSON format exactly:

{
  "verse": {
    "ref": "Book Chapter:Verse",
    "text": "The exact KJV verse text here"
  },
  "reflection": "A warm, pastoral 2-3 sentence reflection connecting the verse to the user's situation. Speak directly to the person, use 'you' language. Do not be preachy — be human and warm.",
  "followUpTopics": ["Topic 1", "Topic 2", "Topic 3"]
}

Rules:
- Always use King James Version (KJV) — exact wording, no paraphrasing
- The verse must be a real, accurate KJV verse — never fabricate scripture
- The reflection should feel personal, not like a sermon
- followUpTopics must be 3 short phrases (2-4 words each) that the user might want to explore next
- Never break the JSON format — only return valid JSON, nothing else`;

export interface AIResponse {
  verse: { ref: string; text: string };
  reflection: string;
  followUpTopics: string[];
}

/**
 * KJV_CANONICAL_TEXT=on: swap the model's verse text for the verbatim KJV
 * text. A reference that isn't real KJV is treated like any other incomplete
 * AI response (throws → the route's existing 500 path). Flag off → untouched.
 */
function applyCanonicalKjv(parsed: AIResponse): AIResponse {
  if (!isCanonicalKjvEnabled()) return parsed;
  const corpus = loadCorpus();
  if (!corpus) return parsed;
  const canon = canonicalText(parsed.verse.ref, corpus);
  const exact = canon !== null && parsed.verse.text.replace(/\s+/g, " ").trim() === canon;
  logGrounding("ai-legacy", {
    total: 1,
    exact: exact ? 1 : 0,
    replaced: canon !== null && !exact ? 1 : 0,
    dropped: canon === null ? 1 : 0,
  });
  if (canon === null) throw new Error("AI returned a reference not found in the KJV");
  return { ...parsed, verse: { ...parsed.verse, text: canon } };
}

export async function getDeeperResponse(
  topic: string,
  question: string,
  previousVerseRef: string
): Promise<AIResponse> {
  const userMessage = `The person already received ${previousVerseRef} on the topic of ${topic}${question ? ` with the question: "${question}"` : ""}. Now give them a DIFFERENT, deeper scripture passage that explores a new angle of this topic — perhaps a related theme, a complementary verse, or a more challenging perspective. Do not repeat the previous verse.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userMessage },
    ],
    temperature: 0.8,
    max_tokens: 600,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0].message.content || "{}";
  const parsed = JSON.parse(raw) as AIResponse;
  if (!parsed.verse?.ref || !parsed.verse?.text || !parsed.reflection) {
    throw new Error("AI returned incomplete response");
  }
  return applyCanonicalKjv(parsed);
}

export async function getScriptureResponse(
  topic: string,
  question: string
): Promise<AIResponse> {
  const userMessage = question
    ? `I'm struggling with ${topic}. My question is: "${question}"`
    : `I'd like scripture and reflection on the topic of ${topic}.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userMessage },
    ],
    temperature: 0.7,
    max_tokens: 600,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0].message.content || "{}";
  const parsed = JSON.parse(raw) as AIResponse;

  // Validate structure — fall back gracefully if AI returns bad format
  if (!parsed.verse?.ref || !parsed.verse?.text || !parsed.reflection) {
    throw new Error("AI returned incomplete response");
  }

  return applyCanonicalKjv(parsed);
}
