import OpenAI from "openai";

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
  return parsed;
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

  return parsed;
}
