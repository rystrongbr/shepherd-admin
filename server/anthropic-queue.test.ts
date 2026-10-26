import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DB_PATH = ":memory:";
const { AnthropicQueue, CapacityError, queueConfig } = await import("./rate-limits.ts");

test("defaults: 60 running, 150 waiting, 45s wait", () => {
  delete process.env.ANTHROPIC_MAX_CONCURRENT;
  delete process.env.ANTHROPIC_MAX_QUEUE;
  delete process.env.ANTHROPIC_QUEUE_TIMEOUT_MS;
  assert.deepEqual(queueConfig(), { maxConcurrent: 60, maxQueue: 150, waitTimeoutMs: 45_000 });
});

test("env overrides and invalid values", () => {
  process.env.ANTHROPIC_MAX_CONCURRENT = "80";
  process.env.ANTHROPIC_MAX_QUEUE = "abc";
  process.env.ANTHROPIC_QUEUE_TIMEOUT_MS = "0";
  assert.deepEqual(queueConfig(), { maxConcurrent: 80, maxQueue: 150, waitTimeoutMs: 45_000 });
  delete process.env.ANTHROPIC_MAX_CONCURRENT;
  delete process.env.ANTHROPIC_MAX_QUEUE;
  delete process.env.ANTHROPIC_QUEUE_TIMEOUT_MS;
});

test("rejects when the waiting line is full", async () => {
  const q = new AnthropicQueue({ maxConcurrent: 1, maxQueue: 1, waitTimeoutMs: 60_000 });
  let release!: () => void;
  const first = q.execute(() => new Promise<void>(r => { release = r; }));
  const second = q.execute(async () => "ok");
  await assert.rejects(() => q.execute(async () => "x"), CapacityError);
  release();
  await first;
  assert.equal(await second, "ok");
});

test("waiting job times out with CapacityError and frees its spot", async () => {
  const q = new AnthropicQueue({ maxConcurrent: 1, maxQueue: 5, waitTimeoutMs: 20 });
  let release!: () => void;
  const first = q.execute(() => new Promise<void>(r => { release = r; }));
  await assert.rejects(() => q.execute(async () => "late"), CapacityError);
  assert.equal(q.depth, 0);
  release();
  await first;
  assert.equal(q.active, 0);
});

test("a failing job still releases its slot", async () => {
  const q = new AnthropicQueue({ maxConcurrent: 1, maxQueue: 5, waitTimeoutMs: 1000 });
  await assert.rejects(() => q.execute(async () => { throw new Error("boom"); }));
  assert.equal(await q.execute(async () => "next"), "next");
});
