// Canonical KJV grounding: reference parsing, lookup, replacement, dropping,
// and the ai-v2 integration (flag on/off). Uses the real bundled corpus.
process.env.NODE_ENV = "test";
delete process.env.KJV_CANONICAL_TEXT;

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const kjv = await import("./canonical.ts");
const ai = await import("../ai-v2.ts");
const corpus = kjv.loadCorpus()!;

test("bundled corpus is complete KJV (66 books, 31,102 verses)", () => {
  assert.ok(corpus);
  assert.equal(Object.keys(corpus.books).length, 66);
  let n = 0;
  for (const b of Object.values(corpus.books)) for (const ch of b.chapters) n += ch.length;
  assert.equal(n, 31102);
  assert.equal(corpus.meta.verses, 31102);
});

test("single verse, preserving LORD caps and punctuation", () => {
  assert.equal(kjv.canonicalText("Psalm 23:1", corpus), "The LORD is my shepherd; I shall not want.");
  assert.equal(kjv.canonicalText("Psalms 23:1", corpus), "The LORD is my shepherd; I shall not want.");
  assert.match(kjv.canonicalText("John 3:16", corpus)!, /^For God so loved the world, that he gave his only begotten Son/);
});

test("corpus includes the shepherd-mobile#44 corrections", () => {
  assert.equal(kjv.canonicalText("John 20:28", corpus), "And Thomas answered and said unto him, My Lord and my God.");
  assert.match(kjv.canonicalText("Genesis 15:2", corpus)!, /^And Abram said, Lord GOD, what wilt thou give me/);
  assert.match(kjv.canonicalText("Joshua 4:5", corpus)!, /take ye up every man/);
  assert.match(kjv.canonicalText("1 John 2:23", corpus)!, /the Father: but he that acknowledgeth/);
  assert.equal(kjv.canonicalText("Psalm 92:1", corpus), "It is a good thing to give thanks unto the LORD, and to sing praises unto thy name, O most High:");
});

test("ranges, en-dash ranges, multi-verse lists, cross-chapter, whole chapter", () => {
  const r = kjv.canonicalText("Philippians 4:6-7", corpus)!;
  assert.ok(r.startsWith("Be careful for nothing;"));
  assert.ok(r.endsWith("through Christ Jesus."));
  assert.equal(kjv.canonicalText("Philippians 4:6–7", corpus), r);
  const list = kjv.canonicalText("Matthew 5:3-4, 6", corpus)!;
  assert.ok(list.startsWith("Blessed are the poor in spirit"));
  assert.ok(list.includes("Blessed are they that mourn"));
  assert.ok(list.endsWith("for they shall be filled."));
  assert.ok(!list.includes("Blessed are the meek")); // 5:5 skipped
  assert.ok(kjv.canonicalText("John 3:36-4:1", corpus)!.startsWith(kjv.canonicalText("John 3:36", corpus)!) && kjv.canonicalText("John 3:36-4:1", corpus)!.includes("When therefore the"));
  const ps23 = kjv.canonicalText("Psalm 23", corpus)!;
  assert.ok(ps23.endsWith("dwell in the house of the LORD for ever."));
});

test("book name variants and abbreviations", () => {
  const want = kjv.canonicalText("1 Corinthians 13:4", corpus);
  assert.ok(want);
  for (const ref of ["First Corinthians 13:4", "I Corinthians 13:4", "1 Cor 13:4", "1 Cor. 13:4", "1 Corinthians 13:4 (KJV)"]) {
    assert.equal(kjv.canonicalText(ref, corpus), want, ref);
  }
  assert.equal(kjv.canonicalText("Phil 4:13", corpus), kjv.canonicalText("Philippians 4:13", corpus));
  assert.ok(kjv.canonicalText("Song of Songs 2:4", corpus));
  assert.ok(kjv.canonicalText("Revelations 21:4", corpus));
});

test("invalid / non-existent references return null", () => {
  for (const ref of ["", "Hezekiah 3:16", "John 3:99", "John 22:1", "Jude 2:1", "Psalm 23:0", "John 3:17-16",
    "Psalm 119", /* >40 verses */ "not a reference", "John three sixteen"]) {
    assert.equal(kjv.canonicalText(ref, corpus), null, ref);
  }
});

test("groundCitations replaces text, keeps other fields, drops invalid, counts", () => {
  const { citations, counts } = kjv.groundCitations(
    [
      { ref: "Psalm 23:1", text: "The LORD is my shepherd; I shall not want.", relevance: "a" },
      { ref: "Proverbs 3:5", text: "Trust the Lord with all your heart", relevance: "b" },
      { ref: "Hezekiah 1:1", text: "made up", relevance: "c" },
    ],
    corpus,
  );
  assert.deepEqual(counts, { total: 3, exact: 1, replaced: 1, dropped: 1 });
  assert.equal(citations.length, 2);
  assert.equal(citations[1].ref, "Proverbs 3:5");
  assert.equal(citations[1].relevance, "b");
  assert.equal(citations[1].text, "Trust in the LORD with all thine heart; and lean not unto thine own understanding.");
});

// ─── ai-v2 integration ────────────────────────────────────────────────

const FOLLOW = ["How do I pray when anxious?", "What if the worry returns?", "How can I trust God more?"];
const answer = (citations: any[]) => ({ answer: "You are not alone.", citations, followUps: FOLLOW });
const reply = (body: unknown) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(body) }],
  usage: { input_tokens: 1, output_tokens: 1 },
});
function fake(...responses: any[]) {
  let n = 0;
  return { calls: () => n, client: { messages: { create: async () => { n++; return responses.shift(); } } } as any };
}
const MODEL_TEXT = "Be careful for nothing, but in everything by prayer and supplication...";
const PARTLY_FAKE = answer([
  { ref: "Philippians 4:6-7", text: MODEL_TEXT, relevance: "r1" },
  { ref: "Hezekiah 4:6", text: "invented", relevance: "r2" },
]);

let logs: string[] = [];
const origLog = console.log;
const origWarn = console.warn;
beforeEach(() => {
  logs = [];
  console.log = (...a: any[]) => { logs.push(a.join(" ")); };
  console.warn = (...a: any[]) => { logs.push(a.join(" ")); };
});
afterEach(() => {
  console.log = origLog;
  console.warn = origWarn;
  delete process.env.KJV_CANONICAL_TEXT;
});

test("flag off (default): response is exactly what the model returned", async () => {
  const f = fake(reply(PARTLY_FAKE));
  ai.setAnthropicClient(f.client);
  const out = await ai.ask({ question: "q" });
  assert.deepEqual(out, PARTLY_FAKE);
  assert.ok(!logs.some((l) => l.includes("[kjv]")));
});

test("flag on: text replaced with canonical KJV, invalid ref dropped, shape unchanged", async () => {
  process.env.KJV_CANONICAL_TEXT = "on";
  const f = fake(reply(PARTLY_FAKE));
  ai.setAnthropicClient(f.client);
  const out = await ai.ask({ question: "my private worry" });
  assert.deepEqual(Object.keys(out).sort(), ["answer", "citations", "followUps"]);
  assert.equal(out.citations.length, 1);
  assert.deepEqual(Object.keys(out.citations[0]).sort(), ["ref", "relevance", "text"]);
  assert.equal(out.citations[0].text, kjv.canonicalText("Philippians 4:6-7", corpus));
  assert.equal(out.citations[0].relevance, "r1");
  assert.deepEqual(out.followUps, FOLLOW);
  const line = logs.find((l) => l.includes("[kjv] ai-v2"))!;
  assert.match(line, /citations=2 exact=0 replaced=1 dropped=1/);
  // No user or model content in logs.
  for (const l of logs) {
    assert.ok(!l.includes("private worry") && !l.includes("Philippians") && !l.includes("careful"), l);
  }
});

test("flag on: all citations invalid → retry once, then same error as any invalid answer", async () => {
  process.env.KJV_CANONICAL_TEXT = "on";
  const bad = answer([{ ref: "Hezekiah 1:1", text: "x", relevance: "y" }]);
  const good = answer([{ ref: "Psalm 23:1", text: "The Lord is my shepherd", relevance: "z" }]);
  let f = fake(reply(bad), reply(good));
  ai.setAnthropicClient(f.client);
  const out = await ai.ask({ question: "q" });
  assert.equal(f.calls(), 2);
  assert.equal(out.citations[0].text, "The LORD is my shepherd; I shall not want.");

  f = fake(reply(bad), reply(bad));
  ai.setAnthropicClient(f.client);
  await assert.rejects(() => ai.ask({ question: "q" }), ai.AiResponseError);
  assert.equal(f.calls(), 2);
});

test("flag on but corpus unavailable: fail open (unchanged), never throws", async () => {
  process.env.KJV_CANONICAL_TEXT = "on";
  process.env.KJV_CORPUS_PATH = "/nonexistent.json";
  const savedCwd = process.cwd();
  process.chdir("/");
  kjv.setCorpusForTests(null);
  console.error = () => {};
  try {
    const f = fake(reply(PARTLY_FAKE));
    ai.setAnthropicClient(f.client);
    assert.deepEqual(await ai.ask({ question: "q" }), PARTLY_FAKE);
  } finally {
    process.chdir(savedCwd);
    delete process.env.KJV_CORPUS_PATH;
    kjv.setCorpusForTests(corpus);
  }
});

test("flag parsing", () => {
  for (const v of ["on", "ON", "true", "1"]) { process.env.KJV_CANONICAL_TEXT = v; assert.equal(kjv.isCanonicalKjvEnabled(), true); }
  for (const v of ["", "off", "false", "0", "yes?"]) { process.env.KJV_CANONICAL_TEXT = v; assert.equal(kjv.isCanonicalKjvEnabled(), false); }
});
