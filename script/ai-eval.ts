/**
 * Side-by-side model eval for My Shepherd AI v2.
 *
 *   ANTHROPIC_API_KEY=... npx tsx script/ai-eval.ts \
 *     --models claude-sonnet-4-5-20250929,claude-sonnet-5-5 \
 *     --kjv-dir ~/shepherd-mobile/src/data/bible/kjv
 *
 * Options: --limit N (first N questions), --effort low|medium|high,
 *          --concurrency N (default 3), --out DIR (default ./ai-eval-results)
 *
 * Writes report.md (for Ryan to read) and results.json. Never prints the key.
 * Crisis questions are first run through the production crisis detector; if
 * it would intercept them, the AI is not called (matching production).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "async_hooks";
import { ask, drillDown, setAnthropicClient, validateResponse, type AskResponse } from "../server/ai-v2";
import { detectCrisisCategory } from "../server/crisis";
import { EVAL_QUESTIONS, type EvalQuestion } from "../server/ai-eval/questions";
import { verifyCitation, type KjvStatus } from "../server/ai-eval/kjvVerify";

// $ per million tokens (input, output). Source: Anthropic pricing page, Oct 2026.
const PRICES: Record<string, [number, number]> = {
  "claude-sonnet-4-5-20250929": [3, 15],
  "claude-sonnet-4-5": [3, 15],
  "claude-sonnet-4-6": [3, 15],
  "claude-sonnet-5-5": [2, 10],
};

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const expandHome = (p: string) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

const models = (arg("models", "claude-sonnet-4-5-20250929,claude-sonnet-5-5") || "").split(",").map(s => s.trim()).filter(Boolean);
const kjvDir = expandHome(arg("kjv-dir", "~/shepherd-mobile/src/data/bible/kjv")!);
const outDir = expandHome(arg("out", "ai-eval-results")!);
const limit = Number(arg("limit", String(EVAL_QUESTIONS.length)));
const effort = arg("effort");
const concurrency = Math.max(1, Number(arg("concurrency", "3")));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Nothing was sent.");
  process.exit(1);
}
const haveKjv = fs.existsSync(kjvDir);
if (!haveKjv) console.warn(`KJV folder not found at ${kjvDir}; citations will not be checked.`);

interface Usage { input: number; output: number; thinking: number; cacheRead: number; cacheWrite: number; calls: number }
interface Row {
  model: string; id: string; kind: string; question: string; passageRef?: string;
  ok: boolean; error?: string; ms: number; interceptedByCrisisCheck?: string;
  usage: Usage; costUsd: number; answer?: AskResponse;
  kjv: Array<{ ref: string; status: KjvStatus; similarity?: number; detail?: string }>;
}

// Wrap the real client so we can record token usage per question.
const real = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// One sink per model; questions within a model run one at a time, so the
// active sink for a model always belongs to the in-flight question.
const usageSinks: Record<string, Usage> = {};
// Models run in parallel, so the model is set per call (not via a shared env var).
const currentModel = new AsyncLocalStorage<string>();
setAnthropicClient({
  messages: {
    create: (async (req: any) => {
      const model = currentModel.getStore();
      if (model) req = { ...req, model };
      const res: any = await real.messages.create(req);
      const usageSink = usageSinks[req.model];
      if (usageSink) {
        const u = res.usage || {};
        usageSink.input += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        usageSink.output += u.output_tokens || 0;
        usageSink.thinking += u.output_tokens_details?.thinking_tokens || 0;
        usageSink.cacheRead += u.cache_read_input_tokens || 0;
        usageSink.cacheWrite += u.cache_creation_input_tokens || 0;
        usageSink.calls += 1;
      }
      return res;
    }) as any,
  } as any,
});

function cost(model: string, u: Usage): number {
  const [pin, pout] = PRICES[model] || [NaN, NaN];
  // Approximation: cache reads billed at 10%, writes at 125% of input.
  const uncachedIn = u.input - u.cacheRead - u.cacheWrite;
  return (uncachedIn * pin + u.cacheRead * pin * 0.1 + u.cacheWrite * pin * 1.25 + u.output * pout) / 1e6;
}

async function runOne(model: string, q: EvalQuestion): Promise<Row> {
  const usage: Usage = { input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
  const row: Row = { model, id: q.id, kind: q.kind, question: q.question, passageRef: q.passageRef, ok: false, ms: 0, usage, costUsd: 0, kjv: [] };
  const crisis = detectCrisisCategory(q.question);
  if (crisis) {
    row.ok = true;
    row.interceptedByCrisisCheck = crisis;
    return row;
  }
  const started = Date.now();
  try {
    usageSinks[model] = usage;
    const answer = q.passageRef
      ? await drillDown({ originalQuestion: q.question, passageRef: q.passageRef })
      : await ask({ question: q.question });
    validateResponse(answer);
    row.ok = true;
    row.answer = answer;
    if (haveKjv) row.kjv = answer.citations.map(c => ({ ref: c.ref, ...verifyCitation(kjvDir, c.ref, c.text) }));
  } catch (err: any) {
    row.error = String(err?.message || err).slice(0, 300);
  } finally {
    row.ms = Date.now() - started;
    row.costUsd = cost(model, usage);
  }
  return row;
}

async function runModel(model: string): Promise<Row[]> {
  if (effort) process.env.ANTHROPIC_EFFORT = effort;
  const qs = EVAL_QUESTIONS.slice(0, limit);
  const rows: Row[] = [];
  // Usage capture needs one in-flight call at a time per sink; keep it simple
  // and correct: concurrency applies across models, questions run in order.
  for (const [i, q] of qs.entries()) {
    process.stdout.write(`  ${model}  ${i + 1}/${qs.length}  ${q.id}\r`);
    rows.push(await currentModel.run(model, () => runOne(model, q)));
  }
  process.stdout.write("\n");
  return rows;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function summarize(model: string, rows: Row[]) {
  const called = rows.filter(r => !r.interceptedByCrisisCheck);
  const ok = called.filter(r => r.ok);
  const kjv = ok.flatMap(r => r.kjv);
  const count = (s: KjvStatus) => kjv.filter(k => k.status === s).length;
  const ms = ok.map(r => r.ms);
  const totalCost = called.reduce((a, r) => a + r.costUsd, 0);
  const avg = (f: (r: Row) => number) => (ok.length ? Math.round(ok.reduce((a, r) => a + f(r), 0) / ok.length) : 0);
  return {
    model, asked: called.length, valid: ok.length, crisisIntercepted: rows.length - called.length,
    medianSec: (median(ms) / 1000).toFixed(1), maxSec: (Math.max(0, ...ms) / 1000).toFixed(1),
    avgIn: avg(r => r.usage.input), avgOut: avg(r => r.usage.output), avgThinking: avg(r => r.usage.thinking),
    costPerAnswer: ok.length ? (totalCost / ok.length).toFixed(4) : "-",
    citations: kjv.length, verified: count("verified"), close: count("close"), mismatch: count("text_mismatch"),
    invalid: count("invalid_ref"), unparsed: count("unparsed"),
  };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Models: ${models.join(", ")}  |  questions: ${Math.min(limit, EVAL_QUESTIONS.length)}  |  KJV check: ${haveKjv ? "on" : "off"}`);
  const all: Record<string, Row[]> = {};
  // Run models in parallel (bounded), questions in order within each model.
  const queue = [...models];
  await Promise.all(Array.from({ length: Math.min(concurrency, models.length) }, async () => {
    while (queue.length) { const m = queue.shift()!; all[m] = await runModel(m); }
  }));

  const sums = models.map(m => summarize(m, all[m]));
  const L: string[] = [];
  L.push(`# My Shepherd AI Eval`, ``, `Run: ${new Date().toISOString()}  |  Effort: ${effort || "default"}  |  KJV check: ${haveKjv ? "on" : "off"}`, ``);
  L.push(`## Summary`, ``);
  L.push(`| Check | ${models.join(" | ")} |`, `|---|${models.map(() => "---").join("|")}|`);
  const line = (label: string, f: (s: ReturnType<typeof summarize>) => string) => L.push(`| ${label} | ${sums.map(f).join(" | ")} |`);
  line("Valid answers", s => `${s.valid}/${s.asked} (${pct(s.valid, s.asked)})`);
  line("Crisis check intercepted (AI not called)", s => String(s.crisisIntercepted));
  line("Median / slowest (sec)", s => `${s.medianSec} / ${s.maxSec}`);
  line("Avg tokens in / out (thinking)", s => `${s.avgIn} / ${s.avgOut} (${s.avgThinking})`);
  line("Est. cost per answer (USD)", s => `$${s.costPerAnswer}`);
  line("Citations checked", s => String(s.citations));
  line("KJV verified", s => `${s.verified} (${pct(s.verified, s.citations)})`);
  line("KJV close (review)", s => String(s.close));
  line("KJV text mismatch", s => String(s.mismatch));
  line("**Invalid reference (fabricated?)**", s => `**${s.invalid}**`);
  line("Unparsed reference", s => String(s.unparsed));
  L.push(``, `Pass bar: 100% valid · 0 invalid references · median ≤ 15s · slowest < 30s · tone/doctrine OK on read-through.`, ``);

  L.push(`## Problems to review`, ``);
  let problems = 0;
  for (const m of models) for (const r of all[m]) {
    if (!r.ok) { L.push(`- **${m} · ${r.id}**: error: ${esc(r.error || "")}`); problems++; }
    for (const k of r.kjv) if (k.status !== "verified") { L.push(`- **${m} · ${r.id}**: ${k.ref}: ${k.status}${k.similarity !== undefined ? ` (similarity ${k.similarity})` : ""}${k.detail ? `: ${esc(k.detail)}` : ""}`); problems++; }
  }
  if (!problems) L.push(`None.`);
  L.push(``, `## Side by side`, ``);
  for (const q of EVAL_QUESTIONS.slice(0, limit)) {
    L.push(`### ${q.id} (${q.kind})`, ``, `**Q:** ${q.question}${q.passageRef ? `  \n**Go deeper on:** ${q.passageRef}` : ""}`, ``);
    for (const m of models) {
      const r = all[m].find(x => x.id === q.id)!;
      L.push(`**${m}** (${(r.ms / 1000).toFixed(1)}s)`, ``);
      if (r.interceptedByCrisisCheck) { L.push(`> Intercepted by crisis safety check (${r.interceptedByCrisisCheck}); AI not called.`, ``); continue; }
      if (!r.ok || !r.answer) { L.push(`> ERROR: ${esc(r.error || "")}`, ``); continue; }
      L.push(`> ${esc(r.answer.answer)}`, ``);
      r.answer.citations.forEach((c, i) => {
        const k = r.kjv[i];
        L.push(`- **${c.ref}**${k ? ` [${k.status}]` : ""}: ${esc(c.text)}  \n  _${esc(c.relevance)}_`);
      });
      L.push(`- Follow-ups: ${r.answer.followUps.map(esc).join(" · ")}`, ``);
    }
  }
  fs.writeFileSync(path.join(outDir, "report.md"), L.join("\n"));
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ sums, all }, null, 2));
  console.log("\nSUMMARY");
  for (const s of sums) console.log(`  ${s.model}: valid ${s.valid}/${s.asked}, median ${s.medianSec}s, slowest ${s.maxSec}s, $${s.costPerAnswer}/answer, KJV verified ${s.verified}/${s.citations}, invalid refs ${s.invalid}`);
  console.log(`\nReport: ${path.join(outDir, "report.md")}`);
}

main().catch(err => { console.error("Eval failed:", err?.message || err); process.exit(1); });
