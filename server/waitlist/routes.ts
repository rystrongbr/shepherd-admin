import express, { type Express, type RequestHandler } from "express";
import path from "node:path";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { createWaitlistStore, exportCsv, CONSENT_VERSION } from "./store";

export type Welcome = { email: string; unsubscribeUrl: string };
export type Dependencies = {
  store: ReturnType<typeof createWaitlistStore>;
  ownerGuard: RequestHandler;
  sendWelcome: (message: Welcome) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  publicDir?: string;
};
const shortText = (max: number) => z.string().trim().max(max)
  .refine(value => !/[\x00-\x1f\x7f]/.test(value)).default("");
const attribution = z.string().max(100).regex(/^[a-zA-Z0-9_. -]*$/).default("");
const schema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  firstName: shortText(80),
  device: z.enum(["", "iphone", "android"]).default(""),
  consent: z.literal(true),
  consentVersion: z.literal(CONSENT_VERSION),
  website: z.string().max(300).default(""),
  source: attribution, medium: attribution, campaign: attribution, content: attribution,
}).strict();
const accepted = { ok: true };

export function registerWaitlist(app: Express, deps: Dependencies) {
  const env = deps.env ?? process.env;
  const publicDir = deps.publicDir ?? path.resolve("my-shepherd-app/waitlist");
  // Fixed path and directory: no broad static mount or SPA fallback changes.
  app.get(/^\/waitlist$/, (_req, res) => res.redirect(302, "/waitlist/"));
  app.use("/waitlist", express.static(publicDir, { index: "index.html", maxAge: 300_000 }));
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const perIp = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10,
    keyGenerator: req => ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown"),
    standardHeaders: "draft-7", legacyHeaders: false,
    message: { error: "Too many attempts. Please try again in 15 minutes." },
  });
  const globalLimit = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 200,
    keyGenerator: () => "launch-waitlist", standardHeaders: false, legacyHeaders: false,
    message: { error: "The signup list is busy. Please try again later." },
  });
  router.post("/", perIp, globalLimit, async (req, res) => {
    if (env.WAITLIST_ENABLED !== "true") {
      return res.status(503).json({ error: "The launch list is not open yet. Please check back soon." });
    }
    if (!req.is("application/json")) return res.status(415).json({ error: "JSON required." });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Check your email and agree to launch updates." });
    if (parsed.data.website) return res.json(accepted); // Honeypot: never store or email.
    try {
      const created = deps.store.insert(parsed.data);
      if (created) {
        let emailStatus: "disabled" | "sent" | "failed" = "disabled";
        if (env.WAITLIST_EMAIL_ENABLED === "true") {
          emailStatus = "failed";
          try {
            const sent = await deps.sendWelcome({
              email: parsed.data.email,
              // A fixed first-party origin, never a supplied Host header.
              // Fragment avoids tokens appearing in server access logs.
              unsubscribeUrl: `https://app.myshepherdapp.church/waitlist/#unsubscribe=${created.token}`,
            });
            if (sent) emailStatus = "sent";
          } catch { /* Saved signup survives email failure. No PII/error payload logging. */ }
        }
        deps.store.setEmailStatus(created.id, emailStatus);
      }
      return res.json(accepted);
    } catch {
      return res.status(503).json({ error: "We couldn't save your signup. Please try again shortly." });
    }
  });
  const unsubscribeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 60,
    keyGenerator: req => ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown"),
    standardHeaders: "draft-7", legacyHeaders: false,
  });
  // Remains available if new signups are disabled. GET cannot change consent.
  router.post("/unsubscribe", unsubscribeLimiter, (req, res) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "JSON required." });
    const token = req.body?.token;
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: "This unsubscribe link is incomplete. Please contact support." });
    }
    try {
      deps.store.unsubscribe(token);
      return res.json(accepted);
    } catch {
      return res.status(503).json({ error: "Please try again or contact support to unsubscribe." });
    }
  });
  router.get("/contacts", deps.ownerGuard, (req, res) => {
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return res.status(400).json({ error: "Invalid page." });
    try { return res.json({ ...deps.store.list(offset), enabled: env.WAITLIST_ENABLED === "true" }); }
    catch { return res.status(503).json({ error: "Waitlist unavailable." }); }
  });
  router.get("/export", deps.ownerGuard, (_req, res) => {
    try {
      res.type("text/csv").attachment("my-shepherd-launch-list.csv");
      return res.send(exportCsv(deps.store.exportActive()));
    } catch { return res.status(503).json({ error: "Export unavailable." }); }
  });
  // Registered before the existing /api gate; every private route explicitly
  // requires the existing owner guard. No changes to the existing allowlist.
  app.use("/api/waitlist", router);
}
