/**
 * Discover feed — storage-layer tests.
 *
 * Run: npm test  (node --import tsx --test)
 *
 * Uses an in-memory SQLite DB (DB_PATH=:memory:) so the real category-balanced
 * sampling SQL, test-user exclusion, and curation logic are exercised end to
 * end — no mocks. DB_PATH MUST be set before importing storage (the module
 * opens the database at import time).
 */

process.env.DB_PATH = ":memory:";

import { test, before } from "node:test";
import assert from "node:assert/strict";
// Dynamic import: static ESM imports are hoisted above the env assignment
// above, and storage.ts opens the DB at module load — so it must be imported
// AFTER DB_PATH is set.
const { storage, sqlite } = await import("../storage.ts");

const ADMIN = "admin";
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const DAY = 24 * 60 * 60 * 1000;

function insertInsight(o: {
  topic: string;
  question: string;
  sessionId?: string;
  churchId?: number | null;
  createdAt?: string;
  verseRef?: string;
  verseText?: string;
  reflection?: string;
}): number {
  const info = sqlite.prepare(
    `INSERT INTO insights (church_id, topic, question, session_id, location, verse_ref, verse_text, reflection, created_at)
     VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)`,
  ).run(
    o.churchId ?? null,
    o.topic,
    o.question,
    o.sessionId ?? "",
    o.verseRef ?? "",
    o.verseText ?? "",
    o.reflection ?? "",
    o.createdAt ?? iso(0),
  );
  return Number(info.lastInsertRowid);
}

function insertUser(email: string, isTest: boolean): number {
  const info = sqlite.prepare(
    `INSERT INTO app_users (email, is_test_user) VALUES (?, ?)`,
  ).run(email, isTest ? 1 : 0);
  return Number(info.lastInsertRowid);
}

before(() => {
  // Fresh slate.
  sqlite.exec(`DELETE FROM insights; DELETE FROM app_users; DELETE FROM curated_questions;`);

  // 15 Faith questions (recent) — should be capped at 10 in the default view.
  for (let i = 0; i < 15; i++) {
    insertInsight({ topic: "Faith", question: `Faith question ${i}`, createdAt: iso(i * 1000), verseRef: "John 3:16", verseText: "For God so loved...", reflection: "R".repeat(i + 1) });
  }
  // 3 Love questions — all should appear (fewer than cap).
  for (let i = 0; i < 3; i++) {
    insertInsight({ topic: "Love", question: `Love question ${i}`, createdAt: iso(i * 1000) });
  }
  // 1 topic-tap with empty question — must be excluded (Discover shows questions).
  insertInsight({ topic: "Prayer", question: "   ", createdAt: iso(0) });

  // Test user's question — must be excluded from the feed.
  const testUserId = insertUser("staff@myshepherdapp.church", true);
  insertInsight({ topic: "Suffering", question: "hidden test-user question", sessionId: `user-${testUserId}`, createdAt: iso(0) });

  // Ryan's question (NOT a test user) — must be INCLUDED.
  const ryanId = insertUser("ryan@myshepherdapp.church", false);
  insertInsight({ topic: "Wisdom", question: "Ryan's real question", sessionId: `user-${ryanId}`, createdAt: iso(0) });

  // An old Anxiety question (40 days ago) — outside 7d/30d, inside 90d.
  insertInsight({ topic: "Anxiety", question: "old anxiety question", createdAt: iso(40 * DAY) });
});

test("category-balanced sample caps each category at 10 and keeps smaller ones whole", () => {
  const res = storage.getDiscoverQuestions({ range: "30d", adminUserId: ADMIN });
  const byCat: Record<string, number> = {};
  for (const q of res.questions) byCat[q.category] = (byCat[q.category] || 0) + 1;

  assert.equal(byCat["Faith"], 10, "Faith should be capped at 10");
  assert.equal(byCat["Love"], 3, "Love has 3, all should appear");
  assert.equal(byCat["Prayer"], undefined, "empty-question topic tap is excluded");
});

test("test users are excluded but Ryan is included", () => {
  const res = storage.getDiscoverQuestions({ range: "30d", adminUserId: ADMIN });
  const questions = res.questions.map(q => q.question);
  assert.ok(!questions.includes("hidden test-user question"), "test user's question must be hidden");
  assert.ok(res.questions.some(q => q.category === "Wisdom"), "Ryan's question must be present");
});

test("every row is anonymized (who=anon, no identifying fields)", () => {
  const res = storage.getDiscoverQuestions({ range: "30d", adminUserId: ADMIN });
  for (const q of res.questions) {
    assert.equal(q.who, "anon");
    assert.ok(!("sessionId" in q), "sessionId must not be exposed");
    assert.ok(!("churchId" in q), "churchId must not be exposed");
    assert.ok(!("location" in q), "location must not be exposed");
  }
});

test("range filter: 40-day-old question only appears at 90d", () => {
  const r7 = storage.getDiscoverQuestions({ range: "7d", adminUserId: ADMIN });
  const r90 = storage.getDiscoverQuestions({ range: "90d", adminUserId: ADMIN });
  assert.ok(!r7.questions.some(q => q.category === "Anxiety"), "old question excluded at 7d");
  assert.ok(r90.questions.some(q => q.category === "Anxiety"), "old question included at 90d");
});

test("stats reflect aggregate over the range", () => {
  const res = storage.getDiscoverQuestions({ range: "30d", adminUserId: ADMIN });
  // 15 Faith + 3 Love + Ryan (Wisdom) = 19 real questions in 30d (test user &
  // empty tap & 40-day-old Anxiety excluded).
  assert.equal(res.stats.total, 19);
  assert.ok(res.stats.categories_covered >= 3);
  assert.equal(typeof res.stats.unique_users, "number");
});

test("category filter switches to full paginated list for that category", () => {
  const res = storage.getDiscoverQuestions({ range: "30d", category: "Faith", adminUserId: ADMIN });
  // 15 Faith total, page size 25 → all 15 on page 1.
  assert.equal(res.pagination.total_count, 15);
  assert.ok(res.questions.every(q => q.category === "Faith"));
});

test("search matches question text", () => {
  const res = storage.getDiscoverQuestions({ range: "30d", search: "Ryan's real", adminUserId: ADMIN });
  assert.equal(res.pagination.total_count, 1);
  assert.equal(res.questions[0].category, "Wisdom");
});

test("longest sort orders by response length desc", () => {
  // Faith reflections grow with index; longest should come first.
  const res = storage.getDiscoverQuestions({ range: "30d", category: "Faith", sort: "longest", adminUserId: ADMIN });
  const lengths = res.questions.map(q => q.reflection.length);
  const sorted = [...lengths].sort((a, b) => b - a);
  assert.deepEqual(lengths, sorted);
});
