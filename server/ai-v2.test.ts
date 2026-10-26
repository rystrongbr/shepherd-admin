// AI v2 structured-output path. Uses a fake Anthropic client; no network.
process.env.NODE_ENV = "test";
delete process.env.ANTHROPIC_MODEL;
delete process.env.ANTHROPIC_MAX_TOKENS;
delete process.env.ANTHROPIC_EFFORT;

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const ai = await import("./ai-v2.ts");

const GOOD = {
  answer: "You are not alone in this. God sees your worry and invites you to bring it to Him.",
  citations: [
    { ref: "Philippians 4:6-7", text: "Be careful for nothing; but in every thing by prayer...", relevance: "It speaks directly to your worry." },
  ],
  followUps: ["How do I pray when anxious?", "What if the worry returns?", "How can I trust God more?"],
};

function reply(body: unknown, extra: Record<string, unknown> = {}) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
    usage: { input_tokens: 100, output_tokens: 50 },
    ...extra,
  };
}

let calls: any[] = [];
function fakeClient(...responses: any[]) {
  calls = [];
  return {
    messages: {
      create: async (req: any) => {
        calls.push(req);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
  } as any;
}

beforeEach(() => {
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MAX_TOKENS;
  delete process.env.ANTHROPIC_EFFORT;
});

test("request uses structured outputs, not forced tool use", async () => {
  ai.setAnthropicClient(fakeClient(reply(GOOD)));
  const out = await ai.ask({ question: "I'm anxious about work" });
  assert.deepEqual(out, GOOD);
  const req = calls[0];
  assert.equal(req.tools, undefined);
  assert.equal(req.tool_choice, undefined);
  assert.equal(req.output_config.format.type, "json_schema");
  assert.equal(req.output_config.format.schema, ai.ANSWER_SCHEMA);
  assert.equal(req.output_config.effort, undefined);
  assert.equal(req.max_tokens, 6000);
  assert.equal(req.model, "claude-sonnet-4-5-20250929");
  assert.equal(req.system[0].cache_control.type, "ephemeral");
});

test("model, max_tokens and effort come from env at call time", async () => {
  process.env.ANTHROPIC_MODEL = "claude-sonnet-5-5";
  process.env.ANTHROPIC_MAX_TOKENS = "8000";
  process.env.ANTHROPIC_EFFORT = "medium";
  ai.setAnthropicClient(fakeClient(reply(GOOD)));
  await ai.ask({ question: "q" });
  assert.equal(calls[0].model, "claude-sonnet-5-5");
  assert.equal(calls[0].max_tokens, 8000);
  assert.equal(calls[0].output_config.effort, "medium");
});

test("invalid env values fall back to safe defaults", () => {
  process.env.ANTHROPIC_MAX_TOKENS = "12";
  process.env.ANTHROPIC_EFFORT = "turbo";
  const cfg = ai.aiConfig();
  assert.equal(cfg.maxTokens, 6000);
  assert.equal(cfg.effort, undefined);
});

test("schema uses only structured-output-safe constraints", () => {
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") assert.equal(node.additionalProperties, false);
    if (node.type === "array") {
      assert.equal(node.maxItems, undefined);
      if (node.minItems !== undefined) assert.ok(node.minItems === 0 || node.minItems === 1);
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(ai.ANSWER_SCHEMA);
});

test("invalid JSON is retried once, then succeeds", async () => {
  ai.setAnthropicClient(fakeClient(reply("not json"), reply(GOOD)));
  const out = await ai.ask({ question: "q" });
  assert.deepEqual(out, GOOD);
  assert.equal(calls.length, 2);
});

test("wrong followUp count is retried once, then errors", async () => {
  const bad = { ...GOOD, followUps: ["only one?"] };
  ai.setAnthropicClient(fakeClient(reply(bad), reply(bad)));
  await assert.rejects(() => ai.ask({ question: "q" }), /exactly 3 followUps/);
  assert.equal(calls.length, 2);
});

test("too many citations is rejected", async () => {
  const bad = { ...GOOD, citations: Array(5).fill(GOOD.citations[0]) };
  ai.setAnthropicClient(fakeClient(reply(bad), reply(bad)));
  await assert.rejects(() => ai.ask({ question: "q" }), /too many citations/);
});

test("truncated answer (max_tokens) is retried", async () => {
  ai.setAnthropicClient(fakeClient(reply("{\"answer\":", { stop_reason: "max_tokens" }), reply(GOOD)));
  const out = await ai.ask({ question: "q" });
  assert.deepEqual(out, GOOD);
  assert.equal(calls.length, 2);
});

test("API errors are not retried by our code", async () => {
  ai.setAnthropicClient(fakeClient(new Error("529 overloaded"), reply(GOOD)));
  await assert.rejects(() => ai.ask({ question: "q" }), /529 overloaded/);
  assert.equal(calls.length, 1);
});

test("text block after a thinking block is parsed", async () => {
  const r = reply(GOOD);
  r.content.unshift({ type: "thinking", thinking: "..." } as any);
  ai.setAnthropicClient(fakeClient(r));
  assert.deepEqual(await ai.ask({ question: "q" }), GOOD);
});

test("drillDown uses the same structured path", async () => {
  ai.setAnthropicClient(fakeClient(reply(GOOD)));
  await ai.drillDown({ originalQuestion: "q", passageRef: "John 3:16" });
  assert.match(calls[0].messages[0].content, /John 3:16/);
  assert.equal(calls[0].output_config.format.type, "json_schema");
});

test("usage log never includes question text", async () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: any[]) => { lines.push(a.join(" ")); };
  try {
    ai.setAnthropicClient(fakeClient(reply(GOOD)));
    await ai.ask({ question: "my secret family situation" });
  } finally {
    console.log = orig;
  }
  const usage = lines.filter(l => l.includes("[ai-v2] usage"));
  assert.equal(usage.length, 1);
  assert.ok(!usage[0].includes("secret"));
  assert.match(usage[0], /in=100 out=50/);
});
