/**
 * Marketing-traffic module — Cloudflare fetch + refresh tests.
 *
 * Run: npm test  (node --import tsx --test)
 *
 * Uses an in-memory SQLite DB (DB_PATH=:memory:) so refreshCloudflareTraffic
 * exercises the real storage insert path. global.fetch is stubbed per-test so
 * no network call is made. DB_PATH MUST be set before importing storage (the
 * module opens the database at import time).
 */

process.env.DB_PATH = ":memory:";

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { storage } = await import("../storage.ts");
const { refreshCloudflareTraffic } = await import("./index.ts");
const { fetchCloudflareUniques30d } = await import("./cloudflare.ts");

const realFetch = globalThis.fetch;

function stubFetch(handler: () => Promise<Response> | Response) {
  globalThis.fetch = (async () => handler()) as typeof fetch;
}

function graphqlOk(uniques: number): Response {
  return new Response(
    JSON.stringify({
      data: { viewer: { zones: [{ httpRequests1dGroups: [{ uniq: { uniques } }] }] } },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.CLOUDFLARE_ZONE_ID = "test-zone";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("refresh skips (no write) when credentials are missing", async () => {
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ZONE_ID;
  let called = false;
  stubFetch(() => {
    called = true;
    return graphqlOk(999);
  });

  const result = await refreshCloudflareTraffic();
  assert.equal(result.ran, false);
  assert.equal(result.reason, "cloudflare_credentials_missing");
  assert.equal(called, false, "must not hit the network without credentials");
  assert.equal(
    storage.getLatestTrafficSnapshot("cloudflare", "uniques_30d"),
    undefined,
  );
});

test("refresh writes a snapshot on a successful fetch", async () => {
  stubFetch(() => graphqlOk(1234));

  const result = await refreshCloudflareTraffic();
  assert.equal(result.ran, true);
  assert.equal(result.value, 1234);

  const latest = storage.getLatestTrafficSnapshot("cloudflare", "uniques_30d");
  assert.ok(latest, "a snapshot row should exist");
  assert.equal(latest!.value, 1234);
  assert.equal(latest!.source, "cloudflare");
  assert.equal(latest!.metric, "uniques_30d");
});

test("refresh skips (no write) when the API returns GraphQL errors", async () => {
  const before = storage.getLatestTrafficSnapshot("cloudflare", "uniques_30d");
  stubFetch(() =>
    new Response(JSON.stringify({ errors: [{ message: "bad token" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  const result = await refreshCloudflareTraffic();
  assert.equal(result.ran, false);
  assert.equal(result.reason, "cloudflare_fetch_failed");

  const after = storage.getLatestTrafficSnapshot("cloudflare", "uniques_30d");
  assert.deepEqual(after, before, "no new snapshot should be written on error");
});

test("fetch returns null on non-200 HTTP status", async () => {
  stubFetch(() => new Response("nope", { status: 403 }));
  const value = await fetchCloudflareUniques30d();
  assert.equal(value, null);
});
