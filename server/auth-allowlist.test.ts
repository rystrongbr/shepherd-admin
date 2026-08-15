// Regression: user-scoped routes must bypass the blanket admin guard.
//
// The /api namespace has a two-layer auth model:
//   1. A blanket requireAdmin gate (routes.ts requireAuth middleware)
//      unless the path is in the PUBLIC allowlist.
//   2. Route-level guards (requireUser) on user-scoped routes.
//
// Any user-scoped route needs to be listed in PUBLIC so the mobile
// client's Bearer <user JWT> can reach the route-level requireUser
// guard instead of being rejected as an admin token first.
//
// This test replays a fake user Bearer against the deployed contract
// paths and asserts they fail with `Authentication required` (from
// requireUser) rather than `Administrator authentication required`
// (from requireAdmin). The two error strings are the tell for which
// guard fired.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { attachUserIfPresent, requireUser, requireAdmin } from "./auth";

function makeApp(publicPaths: string[]) {
  const app = express();
  app.use(express.json());
  app.use("/api", attachUserIfPresent);
  app.use("/api", (req, res, next) => {
    const stripped = req.path;
    if (publicPaths.some((p) => stripped === p || stripped.startsWith(`${p}/`))) return next();
    return requireAdmin(req, res, next);
  });
  app.get("/api/user/me", requireUser, (_req, res) => res.json({ ok: true }));
  app.get("/api/chats", requireUser, (_req, res) => res.json([]));
  return app;
}

async function callWithBearer(app: express.Express, path: string) {
  return await new Promise<{ status: number; body: unknown }>((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { authorization: "Bearer definitely_not_a_valid_jwt" },
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          resolve({ status: r.status, body });
          server.close();
        })
        .catch(() => {
          resolve({ status: 0, body: {} });
          server.close();
        });
    });
  });
}

test("/user/me in PUBLIC allowlist reaches requireUser (mobile can hit it)", async () => {
  const app = makeApp(["/user/me", "/chats"]);
  const { status, body } = await callWithBearer(app, "/api/user/me");
  assert.equal(status, 401);
  assert.deepEqual(body, { error: "Invalid or expired access token" });
});

test("/user/me NOT in PUBLIC allowlist gets stopped by requireAdmin (the bug we fixed)", async () => {
  const app = makeApp(["/chats"]); // /user/me removed
  const { status, body } = await callWithBearer(app, "/api/user/me");
  assert.equal(status, 401);
  assert.deepEqual(body, { error: "Invalid or expired administrator token" });
});

test("/chats stays in the allowlist and reaches requireUser too", async () => {
  const app = makeApp(["/user/me", "/chats"]);
  const { status, body } = await callWithBearer(app, "/api/chats");
  assert.equal(status, 401);
  assert.deepEqual(body, { error: "Invalid or expired access token" });
});
