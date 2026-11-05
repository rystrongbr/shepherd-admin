import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";

process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "account-deletion-isolated-test-secret-not-production";

test("a deleted account's unexpired access token stops working", async () => {
  const { requireUser, attachUserIfPresent } = await import("../auth");
  const { storage, sqlite } = await import("../storage");
  const { registerAccountDeletion } = await import("./deletion");
  const user = storage.createUser({ email: "delete-me@example.com", tier: "plus" });
  const token = jwt.sign({ id: user.id, email: user.email, tier: "plus", kind: "user" }, process.env.JWT_SECRET!, { expiresIn: "15m" });

  const app = express();
  app.use(express.json());
  registerAccountDeletion(app, { db: sqlite, requireUser, log: () => {} });
  app.get("/protected", requireUser, (req, res) => res.json({ tier: req.user!.tier }));
  app.get("/public", attachUserIfPresent, (req, res) => res.json({ user: req.user?.id ?? null }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const auth = { authorization: `Bearer ${token}` };
  try {
    assert.equal((await fetch(`${base}/protected`, { headers: auth })).status, 200);

    const del = await fetch(`${base}/api/user/me`, {
      method: "DELETE",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { deleted: true, demoAccountPreserved: false });

    // Same token, still unexpired: rejected on protected routes, anonymous on public ones.
    assert.equal((await fetch(`${base}/protected`, { headers: auth })).status, 401);
    assert.deepEqual(await (await fetch(`${base}/public`, { headers: auth })).json(), { user: null });
  } finally {
    server.close();
  }
});
