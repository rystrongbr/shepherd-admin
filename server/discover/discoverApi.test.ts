/**
 * Discover API — HTTP endpoint tests.
 *
 * Boots the real Express app via registerRoutes on an ephemeral port and hits
 * the four new endpoints over HTTP, so the admin auth guard, request parsing,
 * response shape, and anonymization are all validated at the boundary.
 *
 * DB_PATH + JWT_SECRET are set before importing storage/routes.
 */

process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "01234567890123456789012345678901";
process.env.NODE_ENV = "test";
// routes.ts eagerly imports ai.ts, which constructs SDK clients at module load.
// Provide dummy keys so the constructors don't throw — no network calls are
// made by these tests.
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.ANTHROPIC_API_KEY ||= "test-anthropic-key";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
// Dynamic imports so DB_PATH / ADMIN_PASSWORD / dummy SDK keys above are all
// in place before storage.ts opens the DB and routes.ts constructs its clients.
const { registerRoutes } = await import("../routes.ts");
const { sqlite } = await import("../storage.ts");

const TOKEN = jwt.sign(
  { kind: "admin", id: 1, email: "ryan@myshepherdapp.church", role: "owner" },
  process.env.JWT_SECRET!,
  { expiresIn: "15m" },
);
let baseUrl = "";
let server: Server;

function seedInsight(topic: string, question: string, sessionId = ""): number {
  const info = sqlite.prepare(
    `INSERT INTO insights (church_id, topic, question, session_id, location, verse_ref, verse_text, reflection, created_at)
     VALUES (1, ?, ?, ?, 'Austin, TX', 'John 3:16', 'For God so loved the world', 'Reflection text', ?)`,
  ).run(topic, question, sessionId, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

before(async () => {
  sqlite.exec(`DELETE FROM insights; DELETE FROM curated_questions;`);
  seedInsight("Faith", "How do I grow my faith?");
  seedInsight("Prayer", "How should I pray?");

  const app = express();
  app.use(express.json());
  server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server?.close();
});

function authed(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

test("GET /api/discover/questions requires auth", async () => {
  const res = await fetch(`${baseUrl}/api/discover/questions`);
  assert.equal(res.status, 401);
});

test("GET /api/discover/questions returns anonymized feed + stats", async () => {
  const res = await authed("/api/discover/questions?range=30d");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.questions));
  assert.ok(body.questions.length >= 2);
  assert.ok(body.stats && typeof body.stats.total === "number");
  assert.ok(body.pagination && typeof body.pagination.total_count === "number");
  assert.ok(body.category_mix && typeof body.category_mix === "object");
  for (const q of body.questions) {
    assert.equal(q.who, "anon");
    assert.ok(!("sessionId" in q) && !("session_id" in q), "no session id");
    assert.ok(!("churchId" in q) && !("church_id" in q), "no church id");
    assert.ok(!("location" in q), "no location");
  }
});

test("curation endpoints: POST persists, GET lists, DELETE removes", async () => {
  const listBefore = await (await authed("/api/discover/curated")).json();
  const targetId = 1;

  const post = await authed("/api/discover/curate", { method: "POST", body: JSON.stringify({ question_id: targetId }) });
  assert.equal(post.status, 200);
  assert.equal((await post.json()).curated, true);

  const listAfter = await (await authed("/api/discover/curated")).json();
  assert.ok(listAfter.curated.includes(targetId), "curated id present after POST");
  assert.equal(listAfter.curated.length, listBefore.curated.length + 1);

  // curated_only view returns just the starred row.
  const curatedView = await (await authed("/api/discover/questions?curated_only=1")).json();
  assert.ok(curatedView.questions.every((q: any) => q.curated === true));
  assert.ok(curatedView.questions.some((q: any) => q.id === targetId));

  const del = await authed(`/api/discover/curate/${targetId}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const listFinal = await (await authed("/api/discover/curated")).json();
  assert.ok(!listFinal.curated.includes(targetId), "curated id gone after DELETE");
});

test("POST /api/discover/curate rejects bad body", async () => {
  const res = await authed("/api/discover/curate", { method: "POST", body: JSON.stringify({ question_id: "nope" }) });
  assert.equal(res.status, 400);
});
