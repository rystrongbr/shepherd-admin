// Verifies the /api/v1 shim rewrites correctly and preserves behaviour.
// The shim is a URL rewrite in server/index.ts, so we replicate it here with
// a minimal express app that mounts a couple of representative routes.

process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "01234567890123456789012345678901";
process.env.NODE_ENV = "test";

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Request, Response } from "express";
import http from "node:http";

/** Mirror of the shim in server/index.ts. If that changes, keep this in sync. */
function apiV1Shim(req: Request, res: Response, next: () => void) {
  if (req.url.startsWith("/api/v1/") || req.url === "/api/v1") {
    req.url = req.url.replace(/^\/api\/v1(\/|$)/, "/api$1");
    res.setHeader("X-API-Version", "v1");
  }
  next();
}

function bootServer(): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(apiV1Shim);
  app.use(express.json());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  // Body-or-query handler mirrors the AI-endpoint pattern.
  const askHandler = (req: Request, res: Response) => {
    const src: any = req.body && Object.keys(req.body).length ? req.body : req.query;
    const question = String(src.question || "").trim();
    if (!question) return res.status(400).json({ error: "question is required" });
    res.json({ echoed: question });
  };
  app.get("/api/ai/ask", askHandler);
  app.post("/api/ai/ask", askHandler);

  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

async function fetchJson(port: number, path: string, init?: RequestInit) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body, version: res.headers.get("x-api-version") };
}

test("/api/v1/health rewrites to /api/health with X-API-Version header", async () => {
  const { server, port } = await bootServer();
  try {
    const v1 = await fetchJson(port, "/api/v1/health");
    assert.equal(v1.status, 200);
    assert.deepEqual(v1.body, { ok: true });
    assert.equal(v1.version, "v1");

    const legacy = await fetchJson(port, "/api/health");
    assert.equal(legacy.status, 200);
    assert.deepEqual(legacy.body, { ok: true });
    assert.equal(legacy.version, null); // no v1 header on legacy path
  } finally {
    server.close();
  }
});

test("POST /api/v1/ai/ask accepts body payload", async () => {
  const { server, port } = await bootServer();
  try {
    const out = await fetchJson(port, "/api/v1/ai/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What is peace?" }),
    });
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { echoed: "What is peace?" });
    assert.equal(out.version, "v1");
  } finally {
    server.close();
  }
});

test("GET /api/ai/ask?question=... still works (web app contract)", async () => {
  const { server, port } = await bootServer();
  try {
    const out = await fetchJson(port, "/api/ai/ask?question=What+is+joy%3F");
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { echoed: "What is joy?" });
  } finally {
    server.close();
  }
});

test("v1 prefix does not leak into other paths", async () => {
  const { server, port } = await bootServer();
  try {
    // /api/v1something should NOT be rewritten (no trailing slash)
    const out = await fetch(`http://127.0.0.1:${port}/api/v1something`);
    assert.equal(out.status, 404);
    assert.equal(out.headers.get("x-api-version"), null);
  } finally {
    server.close();
  }
});
