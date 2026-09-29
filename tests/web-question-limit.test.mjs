import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const root = new URL("../my-shepherd-app/", import.meta.url);
const helper = fs.readFileSync(new URL("web-question-limit.js", root), "utf8");
const html = fs.readFileSync(new URL("index.html", root), "utf8");
const app = fs.readFileSync(new URL("app.js", root), "utf8");

function helperContext(storage = new Map()) {
  const c = vm.createContext({
    localStorage: {
      getItem: k => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
    },
  });
  vm.runInContext(helper, c);
  return c.WebQuestionLimit;
}

test("quota, capacity, invalid JSON and server failure are distinct", async () => {
  const h = helperContext();
  assert.equal(h.classify(429, { error: "Daily question limit reached. Please come back tomorrow." }), "quota");
  assert.equal(h.classify(429, { error: "We're at capacity right now." }), "capacity");
  assert.equal(h.classify(500, { error: "Daily question limit reached." }), "unavailable");
  await assert.rejects(h.readResponse({ ok: false, status: 429, json: async () => { throw Error(); } }), e => e.kind === "capacity");
  await assert.rejects(h.readResponse({ ok: false, status: 500, json: async () => ({}) }), e => e.kind === "unavailable");
  assert.deepEqual(await h.readResponse({ ok: true, json: async () => ({ answer: "ok" }) }), { answer: "ok" });
});

test("invitation starts after three responses, survives refresh, separates identities and rolls over", () => {
  const storage = new Map();
  const h = helperContext(storage);
  const day = new Date("2026-09-29T12:00:00Z");
  assert.equal(h.recordAnswer("guest", day), false);
  assert.equal(h.recordAnswer("guest", day), false);
  assert.equal(helperContext(storage).recordAnswer("guest", day), true);
  assert.equal(h.recordAnswer("user-1", day), false);
  assert.equal(h.recordAnswer("guest", new Date("2026-09-30T12:00:00Z")), false);
});

test("blocked storage does not break the invitation", () => {
  const c = vm.createContext({});
  vm.runInContext(helper, c);
  assert.equal(c.WebQuestionLimit.recordAnswer("guest"), false);
  assert.equal(c.WebQuestionLimit.recordAnswer("guest"), false);
  assert.equal(c.WebQuestionLimit.recordAnswer("guest"), true);
});

function fixture(t, replies) {
  const dom = new JSDOM(html, { url: "https://web-preview.example/", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.scrollTo = () => {};
  const requests = [];
  w.fetch = async (url) => {
    if (!String(url).includes("/api/ai/")) return { ok: true, json: async () => ({}) };
    requests.push(String(url));
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    assert.ok(reply, "unexpected extra AI request");
    return { ok: (reply.status || 200) < 400, status: reply.status || 200, json: async () => reply.body };
  };
  w.eval(helper);
  // Do not run auth, analytics or startup traffic in a unit fixture.
  w.eval(app.replace('document.addEventListener("DOMContentLoaded", init);', "") + `
    currentTopic = "Faith";
    window.testState = () => ({isLoading});
    window.testSetUser = user => { currentUser = user; };
  `);
  return { w, requests, text: () => w.document.getElementById("response-content").textContent };
}

const answer = n => ({ body: {
  answer: `Test answer ${n}`, citations: [{ ref: "Psalm 46:10", text: "Be still, and know that I am God.", relevance: "Stillness" }],
  followUps: ["How can I reflect on this?"],
} });
const quota = { status: 429, body: { error: "Daily question limit reached. Please come back tomorrow.", limit: 3 } };

test("Ask, Go Deeper and passage each advance invitation; fourth response preserves answer without fallback", async t => {
  const { w, requests, text } = fixture(t, [answer(1), answer(2), answer(3), quota]);
  await w.showResponse("Faith", "Where can I find peace?");
  assert.equal(w.document.querySelector(".web-question-notice"), null);
  await w.goDeeperOnCurrent();
  assert.equal(w.document.querySelector(".web-question-notice"), null);
  await w.drillDownOnPassage("Psalm 46:10");
  assert.match(w.document.getElementById("web-question-notice").textContent, /Continue your journey/);
  const oldNode = w.document.querySelector(".v2-answer");
  await w.showResponse("Faith", "Another question");
  assert.match(text(), /Test answer 3/);
  assert.equal(w.document.querySelector(".v2-answer"), oldNode, "same readable response retained");
  assert.match(w.document.getElementById("web-question-notice").textContent, /Daily allowance reached/);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(url => !url.includes("/scripture")));
  assert.match(w.document.querySelector(".web-question-notice__cta").href, /\/waitlist\/\?utm_source=webapp/);
  assert.equal(w.testState().isLoading, false);
});

test("limit on first request works after refresh without fake answer or a last-answer promise", async t => {
  const { w, requests, text } = fixture(t, [quota]);
  await w.showResponse("Faith", "Question");
  assert.equal(text(), "");
  assert.match(w.document.getElementById("web-question-notice").textContent, /Daily allowance reached/);
  assert.equal(requests.length, 1);
  assert.doesNotMatch(w.document.getElementById("web-question-notice").textContent, /previous answer/);
});

test("failed question remains in the input for a deliberate retry", async t => {
  const { w } = fixture(t, [quota]);
  w.document.getElementById("question-input").value = "How can I find hope?";
  await w.handleAsk();
  assert.equal(w.document.getElementById("question-input").value, "How can I find hope?");
});

for (const [name, reply] of [
  ["capacity", { status: 429, body: { error: "We're at capacity right now. Please try again in a moment." } }],
  ["network", new Error("offline")],
  ["server", { status: 500, body: { error: "AI response failed" } }],
]) {
  test(`${name} failure preserves answer and is not marketed as exhausted allowance`, async t => {
    const { w, requests, text } = fixture(t, [answer(1), reply]);
    await w.showResponse("Faith", "Question");
    await w.goDeeperOnCurrent();
    assert.match(text(), /Test answer 1/);
    assert.equal(w.document.querySelector(".web-question-notice__cta"), null);
    assert.equal(requests.length, 2);
    assert.equal(w.testState().isLoading, false);
  });
}

test("crisis response removes marketing and is not counted toward invitation", async t => {
  const crisis = { body: {
    type: "crisis_safety", urgency: "HIGH", acknowledgment: "Please reach out.",
    resources: { primary: { name: "Suicide & Crisis Lifeline", number: "988" } },
  } };
  const { w } = fixture(t, [answer(1), answer(2), crisis, answer(3)]);
  await w.showResponse("Faith", "Question one");
  await w.showResponse("Faith", "Question two");
  await w.showResponse("Faith", "Test safety fixture");
  assert.ok(w.document.querySelector(".crisis-card"));
  assert.equal(w.document.querySelector(".web-question-notice"), null);
  await w.showResponse("Faith", "Question three");
  assert.match(w.document.getElementById("web-question-notice").textContent, /Continue your journey/);
});

test("paid limit gets no false three-question lock, only a launch invitation", async t => {
  const { w, requests } = fixture(t, [answer(1), answer(2), answer(3), answer(4)]);
  w.testSetUser({id: 99, email: "test@example.invalid"});
  for (let i = 0; i < 4; i++) await w.showResponse("Faith", `Question ${i}`);
  assert.equal(requests.length, 4);
  assert.match(w.document.getElementById("web-question-notice").textContent, /Continue your journey/);
  assert.doesNotMatch(w.document.getElementById("web-question-notice").textContent, /allowance reached/);
});
