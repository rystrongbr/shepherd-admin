/**
 * Private review preview only. Never imports production storage, auth, email,
 * credentials or app routes. All visitor data is in-memory; no emails are sent.
 * Run from repo root: npx tsx script/waitlist-preview.ts
 */
import express from "express";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createWaitlistStore } from "../server/waitlist/store";
import { registerWaitlist } from "../server/waitlist/routes";

const previewDir = path.resolve("../shepherd-waitlist-preview");
const source = path.resolve("my-shepherd-app/waitlist");
fs.mkdirSync(previewDir, { recursive: true });
for (const file of ["index.html", "base.css", "waitlist.css", "waitlist.js"]) {
  let text = fs.readFileSync(path.join(source, file), "utf8");
  if (file === "waitlist.js") {
    text = text.replace('const API_BASE = "";',
      'const API_BASE = "__PORT_8765__".startsWith("__") ? "" : "__PORT_8765__";')
      .replace("const PREVIEW = false;", "const PREVIEW = true;");
  }
  if (file === "index.html") text = text.replace('<meta name="referrer"', '<meta name="robots" content="noindex,nofollow"><meta name="referrer"');
  fs.writeFileSync(path.join(previewDir, file), text);
}
const app = express();
app.use(express.json({ limit: "16kb" }));
app.use((_req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});
app.options("/{*path}", (_req, res) => { res.sendStatus(204); });
// Each preview visitor has a separate throwaway DB. No admin data interface.
const visitors = new Map<string, ReturnType<typeof express>>();
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/waitlist")) return next();
  const key = String(req.header("x-visitor-id") || "local-qa").slice(0, 200);
  let visitor = visitors.get(key);
  if (!visitor) {
    if (visitors.size >= 200) return res.sendStatus(503);
    visitor = express();
    registerWaitlist(visitor, {
      store: createWaitlistStore(new Database(":memory:")),
      env: { WAITLIST_ENABLED: "true", WAITLIST_EMAIL_ENABLED: "false" },
      ownerGuard: (_req, response) => { response.sendStatus(401); },
      sendWelcome: async () => { throw new Error("Preview cannot send email"); },
      publicDir: previewDir,
    });
    visitors.set(key, visitor);
  }
  visitor(req, res, next);
});
app.use(express.static(previewDir));
app.listen(8765, "0.0.0.0", () => console.log("Private waitlist preview on 8765. No production data or mail."));
