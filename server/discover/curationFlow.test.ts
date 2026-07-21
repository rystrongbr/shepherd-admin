/**
 * Discover curation flow — integration test.
 *
 * Walks the full lifecycle the spec calls out:
 *   star → persist → filter (curated only) → unstar → filter.
 *
 * Exercises the real storage methods (add/remove/getCuratedQuestionIds) and the
 * curated_only path of getDiscoverQuestions against an in-memory DB. DB_PATH is
 * set before importing storage.
 */

process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
// Dynamic import so DB_PATH is set before storage.ts opens the database.
const { storage, sqlite } = await import("../storage.ts");

const ADMIN = "admin";
const OTHER_ADMIN = "admin-2";

function insertInsight(topic: string, question: string): number {
  const info = sqlite.prepare(
    `INSERT INTO insights (church_id, topic, question, session_id, location, verse_ref, verse_text, reflection, created_at)
     VALUES (NULL, ?, ?, '', '', 'Psalm 23:1', 'The Lord is my shepherd', 'A reflection', ?)`,
  ).run(topic, question, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

test("curation flow: star → persist → filter → unstar → filter", () => {
  sqlite.exec(`DELETE FROM insights; DELETE FROM curated_questions;`);
  const q1 = insertInsight("Faith", "How do I grow my faith?");
  const q2 = insertInsight("Prayer", "How should I pray?");

  // Nothing curated yet.
  assert.deepEqual(storage.getCuratedQuestionIds(ADMIN), []);
  let curatedView = storage.getDiscoverQuestions({ range: "30d", curatedOnly: true, adminUserId: ADMIN });
  assert.equal(curatedView.questions.length, 0, "curated-only view starts empty");

  // ── Star q1 ──
  storage.addCuration(ADMIN, q1);
  assert.deepEqual(storage.getCuratedQuestionIds(ADMIN), [q1], "q1 persisted");

  // Star is idempotent — re-starring does not create a duplicate.
  storage.addCuration(ADMIN, q1);
  assert.deepEqual(storage.getCuratedQuestionIds(ADMIN), [q1], "re-star is a no-op");

  // ── Filter: curated only shows q1, flagged curated ──
  curatedView = storage.getDiscoverQuestions({ range: "30d", curatedOnly: true, adminUserId: ADMIN });
  assert.equal(curatedView.questions.length, 1);
  assert.equal(curatedView.questions[0].id, q1);
  assert.equal(curatedView.questions[0].curated, true);
  assert.equal(curatedView.stats.curated_count, 1);

  // Full (unfiltered) view flags q1 curated, q2 not.
  const fullView = storage.getDiscoverQuestions({ range: "30d", adminUserId: ADMIN });
  const map = new Map(fullView.questions.map(q => [q.id, q.curated]));
  assert.equal(map.get(q1), true);
  assert.equal(map.get(q2), false);

  // Curation is per-admin: a different admin sees nothing curated.
  assert.deepEqual(storage.getCuratedQuestionIds(OTHER_ADMIN), []);
  const otherView = storage.getDiscoverQuestions({ range: "30d", curatedOnly: true, adminUserId: OTHER_ADMIN });
  assert.equal(otherView.questions.length, 0, "per-admin isolation");

  // ── Unstar q1 ──
  storage.removeCuration(ADMIN, q1);
  assert.deepEqual(storage.getCuratedQuestionIds(ADMIN), [], "q1 removed");

  // Unstar is idempotent — removing a non-curated row is a no-op.
  storage.removeCuration(ADMIN, q1);
  assert.deepEqual(storage.getCuratedQuestionIds(ADMIN), []);

  // ── Filter again: back to empty ──
  curatedView = storage.getDiscoverQuestions({ range: "30d", curatedOnly: true, adminUserId: ADMIN });
  assert.equal(curatedView.questions.length, 0, "curated-only view empty after unstar");
  assert.equal(curatedView.stats.curated_count, 0);
});
