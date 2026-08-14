import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import { randomBytes } from "crypto";
import { storage } from "./storage";
import { db } from "./storage";
import { sql } from "drizzle-orm";
import { getScriptureResponse, getDeeperResponse } from "./ai";
import { ask as askV2, drillDown as drillDownV2, isV2Configured } from "./ai-v2";
import { crisisSafetyCheck } from "./crisis";
import { insertMemberSchema, insertCampaignSchema, insertSequenceSchema, insertChurchSchema, insertInsightSchema, insertAffiliationSchema } from "@shared/schema";
import { z } from "zod";
import {
  testConnection,
  syncMember,
  syncAllMembers,
  removeMember,
  createCampaign,
  sendCampaign,
  getCampaignStats,
  buildDevotionalEmailHtml,
  buildWelcomeEmailHtml,
  provisionChurch,
  emailConfig,
  // Phase B
  handleSendGridWebhook,
  listEmailCrons,
  runSegmentationNow,
  // Phase B.5
  listDeactivations,
  restoreMember,
  recomputeDonors,
  buildDigestSummary,
  renderFounderDigest,
  runFounderDigestNow,
  type SendGridConfig,
  type DeactivationListFilters,
} from "./email";
// sgSendMail is module-private — routes.ts only uses it via these two
// transactional helpers (magic-link + onboard notification). Phase B will
// move them into server/email/transactional.ts so this import goes away.
import { sgSendMail } from "./email/sendgrid-client";
import { registerDonationRoutes } from "./donations";
import { refreshCloudflareTraffic } from "./traffic";
import { registerChurchSignupRoute } from "./church-signup";
import {
  attachUserIfPresent, createAdmin, findAdminByEmail, findAdminById, issueAdminTokens,
  issueUserTokens, refreshTokens, requireAdmin, requireUser,
  verifyGoogleIdToken,
} from "./auth";
import { anonymousQuestionLimiter, authenticatedQuestionQuota, queueAnthropic } from "./rate-limits";
import bcrypt from "bcryptjs";

// ─── Auth middleware ────────────────────────────────────────────────────────
// Simple token-based auth for the admin dashboard.
// The frontend sends Authorization: Bearer <token> on every API request.
// The token is the SHA-256 hash of the admin password stored in ADMIN_PASSWORD env var.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Public routes — no auth required
  // NOTE: app.use("/api", ...) strips the "/api" prefix from req.path
  // So req.path here is /auth/login, /ai/scripture, etc. (no /api prefix)
  const PUBLIC = [
    "/health",
    "/auth/login",
    "/insights/log",
    "/insights/trending",
    "/affiliations",
    "/churches/search",
    "/churches/nearby",
    "/ai/scripture",
    "/ai/deeper",
    "/ai/ask",
    "/ai/passage",
    "/onboard",
    "/user/magic-link",
    "/user/verify",
    "/user/google",
    "/user/refresh",
    "/admin/refresh",
    "/chats",
    "/donations",
    "/church-signup",
    // SendGrid event webhook — authenticated via Ed25519 signature in handler,
    // not via the admin bearer token. Must be in the public allowlist.
    "/email/webhook",
  ];
  if (PUBLIC.some(p => req.path === p || req.path.startsWith(`${p}/`))) return next();
  // Also allow GET /affiliations/:sessionId (for session restore)
  if (req.method === "GET" && req.path.match(/^\/affiliations\//)) return next();
  // POST /member-signups is public (consumer-facing first-visit modal).
  // GET /member-signups/count stays admin-only, so we match POST exactly
  // rather than adding the prefix to the PUBLIC allowlist.
  if (req.method === "POST" && req.path === "/member-signups") return next();

  return requireAdmin(req, res, next);
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use("/api", attachUserIfPresent);
  // Apply auth middleware to all /api routes
  app.use("/api", requireAuth);

  // Donation routes (consumer-facing, in the public allowlist above).
  registerDonationRoutes(app);

  // Church-prospect signup route (myshepherdapp.church landing page form).
  registerChurchSignupRoute(app);

  // ─── Health check (Railway / uptime monitors) ────────────────────────────
  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // ─── Demo Environment: Reset & Status ────────────────────────────────────
  // These endpoints exist ONLY in the demo environment. Production never sets
  // ALLOW_DEMO_RESET, so the endpoint returns 404 there. Auth is still required
  // (admin Bearer token) on top of the env gate so a leaked demo URL can't
  // wipe data without the admin password.

  app.get("/api/demo/status", (_req, res) => {
    res.json({
      isDemoEnv: process.env.ALLOW_DEMO_SEED === "true",
      resetEnabled: process.env.ALLOW_DEMO_RESET === "true",
      seedEnabled: process.env.ALLOW_DEMO_SEED === "true",
    });
  });

  app.post("/api/demo/reset", async (_req, res) => {
    if (process.env.ALLOW_DEMO_RESET !== "true") {
      return res.status(404).json({ error: "Not found" });
    }
    try {
      const { resetDemoData } = await import("./demoReset.js");
      const result = resetDemoData();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[demo/reset] failed:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // ─── App User Auth (Magic Link + Google) ────────────────────────────

  /**
   * POST /api/user/magic-link
   * Send a magic login link to the user's email.
   * Public — no auth required.
   */
  app.post("/api/user/magic-link", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });

    // Optional Sign Up fields. Trim + normalize; empty → null. Persisted on the
    // user row at create/link time so they survive the magic-link round-trip.
    const homeChurchName = (typeof req.body.homeChurchName === "string"
      ? req.body.homeChurchName.trim().slice(0, 200) : "") || null;
    // ZIP: optional, but if provided must be exactly 5 digits.
    const rawZip = typeof req.body.zipCode === "string" ? req.body.zipCode.trim() : "";
    if (rawZip && !/^\d{5}$/.test(rawZip)) {
      return res.status(400).json({ error: "zipCode must be 5 digits" });
    }
    const zipCode = rawZip || null;

    // Generate a secure token
    const token = randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

    storage.setMagicToken(email, token, expiry, { homeChurchName, zipCode });

    // Build magic link URL
    const baseUrl = process.env.APP_URL || "https://app.myshepherdapp.church";
    const magicUrl = `${baseUrl}/#?magic=${token}`;

    // Resolve SendGrid config: env vars first, fall back to legacy church-row
    // setup so existing installs keep working until migrated.
    const sgApiKey = process.env.SENDGRID_API_KEY || storage.getChurch(1)?.sendgridApiKey;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || "hello@myshepherdapp.church";
    const fromName  = process.env.SENDGRID_FROM_NAME  || "My Shepherd";

    if (!sgApiKey) {
      console.error("Magic link email NOT sent: SENDGRID_API_KEY is not configured.");
      return res.status(500).json({ ok: false, error: "Email service not configured" });
    }

    // Send via SendGrid
    try {
      await sgSendMail(
        {
          apiKey: sgApiKey,
          fromEmail,
          fromName,
        },
        {
          to: email,
          subject: "Your My Shepherd sign-in link",
          html: `
            <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;background:#f5f0eb;padding:32px;border-radius:12px;">
              <h2 style="color:#7B4A1E;margin:0 0 8px;">My Shepherd</h2>
              <p style="color:#5A4A3A;margin:0 0 24px;">Click the button below to sign in. This link expires in 15 minutes.</p>
              <a href="${magicUrl}" style="display:inline-block;background:#7B4A1E;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif;font-weight:600;">Sign In to My Shepherd</a>
              <p style="color:#9A8A7A;font-size:12px;margin-top:24px;font-family:Arial,sans-serif;">If you didn't request this, you can ignore this email.</p>
            </div>
          `,
          categories: ["magic-link"],
        },
      );
      res.json({ ok: true, message: "Magic link sent" });
    } catch (emailErr: any) {
      console.error("Magic link email failed:", emailErr?.message);
      return res.status(502).json({ ok: false, error: "Email send failed" });
    }
  });

  /**
   * GET /api/user/verify?token=...
   * Verify a magic link token and return user data.
   * Public — called from the app after redirect.
   */
  app.get("/api/user/verify", (req, res) => {
    const token = String(req.query.token || "").trim();
    if (!token) return res.status(400).json({ error: "token is required" });
    const user = storage.verifyMagicToken(token);
    if (!user) return res.status(401).json({ error: "Invalid or expired token" });
    const tokens = issueUserTokens(res, { id: user.id, email: user.email, tier: (user as any).tier || "free" });
    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, churchId: user.churchId }, ...tokens });
  });

  /**
   * POST /api/user/google
   * Sign in or create account with Google ID token.
   * Public — called from the app after Google sign-in.
   */
  app.post("/api/user/google", async (req, res) => {
    if (typeof req.body?.idToken !== "string") return res.status(400).json({ error: "Google ID token is required" });
    try {
      const { googleId, email, name } = await verifyGoogleIdToken(req.body.idToken);
      let user = storage.getUserByGoogleId(googleId) || storage.getUserByEmail(email);
      if (user) {
        user = storage.updateUser(user.id, { googleId, name: name || user.name, lastLoginAt: new Date().toISOString() })!;
      } else {
        user = storage.createUser({ email, name, googleId, createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString() });
      }
      const tokens = issueUserTokens(res, { id: user.id, email: user.email, tier: (user as any).tier || "free" });
      return res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, churchId: user.churchId }, ...tokens });
    } catch {
      return res.status(401).json({ error: "Google identity verification failed" });
    }
  });

  /**
   * GET /api/user/me?userId=...
   * Get user profile. Public (user identified by ID passed from app).
   */
  app.post("/api/user/refresh", (req, res) =>
    refreshTokens(req, res, "user", id => {
      const user = storage.getUserById(id);
      return user ? { id: user.id, email: user.email, tier: (user as any).tier || "free" } : undefined;
    }),
  );

  app.get("/api/user/me", requireUser, (req, res) => {
    const user = storage.getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ id: user.id, email: user.email, name: user.name, churchId: user.churchId });
  });

  // ─── Chat History ───────────────────────────────────────────────────────────────────

  /**
   * POST /api/chats
   * Save a chat (topic + verse + reflection) for a logged-in user.
   * Public — userId passed in body.
   */
  app.post("/api/chats", requireUser, (req, res) => {
    const { topic, question, verseRef, verseText, reflection } = req.body;
    if (!topic) return res.status(400).json({ error: "topic required" });
    const chat = storage.saveChat({
      userId: req.user!.id, topic,
      question: question || "",
      verseRef: verseRef || "",
      verseText: verseText || "",
      reflection: reflection || "",
      createdAt: new Date().toISOString(),
    });
    res.json(chat);
  });

  /**
   * GET /api/chats?userId=1&q=anxiety
   * Get chat history for a user, optionally filtered by search query.
   */
  app.get("/api/chats", requireUser, (req, res) => {
    const q = String(req.query.q || "").trim();
    const chatList = q
      ? storage.searchUserChats(req.user!.id, q)
      : storage.getUserChats(req.user!.id, 50);
    res.json(chatList);
  });

  // ─── Auth ──────────────────────────────────────────────────────────────────

  /**
   * POST /api/auth/login
   * Validate password and return a session token.
   * Body: { password: string }
   */
  app.post("/api/auth/login", (req, res) => {
    const admin = findAdminByEmail(String(req.body?.email || ""));
    const password = String(req.body?.password || "");
    if (!admin || !admin.is_active || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    db.run(sql`UPDATE admin_users SET last_login_at = ${new Date().toISOString()} WHERE id = ${admin.id}`);
    return res.json({ ok: true, ...issueAdminTokens(res, { id: admin.id, email: admin.email, role: admin.role }) });
  });

  app.post("/api/admin/refresh", (req, res) => refreshTokens(req, res, "admin", findAdminById));
  app.post("/api/admin/users", requireAdmin, (req, res) => {
    try {
      return res.status(201).json({ admin: createAdmin(String(req.body?.email || ""), String(req.body?.password || ""), String(req.body?.role || "admin")) });
    } catch (error: any) {
      return res.status(400).json({ error: error.message || "Unable to create administrator" });
    }
  });

  // ─── AI Scripture ──────────────────────────────────────────────────────────

  /**
   * POST /api/ai/scripture
   * Body: { topic, question? }
   */
  app.post("/api/ai/scripture", anonymousQuestionLimiter, authenticatedQuestionQuota, crisisSafetyCheck, async (req, res) => {
    const { topic, question = "" } = req.body;
    if (!topic) return res.status(400).json({ error: "topic is required" });
    try {
      const result = await queueAnthropic(res, () => getScriptureResponse(topic, question));
      if (!result) return;
      res.json(result);
    } catch (err: any) {
      console.error("AI scripture error:", err.message);
      res.status(500).json({ error: "AI response failed", detail: err.message });
    }
  });

  /**
   * GET /api/ai/scripture?topic=Anxiety&question=...
   * Same as POST but via GET so iframe sandbox fetch restrictions don't block it.
   */
  app.get("/api/ai/scripture", anonymousQuestionLimiter, authenticatedQuestionQuota, crisisSafetyCheck, async (req, res) => {
    const topic = String(req.query.topic || "").trim();
    const question = String(req.query.question || "").trim();
    if (!topic) return res.status(400).json({ error: "topic is required" });
    try {
      const result = await queueAnthropic(res, () => getScriptureResponse(topic, question));
      if (!result) return;
      res.json(result);
    } catch (err: any) {
      console.error("AI scripture GET error:", err.message);
      res.status(500).json({ error: "AI response failed", detail: err.message });
    }
  });

  /**
   * GET /api/ai/deeper?topic=Anxiety&question=...&prevRef=Philippians+4:6
   * Returns a deeper, different scripture on the same topic.
   */
  app.get("/api/ai/deeper", anonymousQuestionLimiter, authenticatedQuestionQuota, crisisSafetyCheck, async (req, res) => {
    const topic    = String(req.query.topic    || "").trim();
    const question = String(req.query.question || "").trim();
    const prevRef  = String(req.query.prevRef  || "").trim();
    if (!topic) return res.status(400).json({ error: "topic is required" });
    try {
      const result = await queueAnthropic(res, () => getDeeperResponse(topic, question, prevRef));
      if (!result) return;
      res.json(result);
    } catch (err: any) {
      console.error("AI deeper error:", err.message);
      res.status(500).json({ error: "AI response failed", detail: err.message });
    }
  });

  // ─── AI v2 (Sonnet, question-led, multi-citation) ───────────────────────
  // These endpoints power the Stage A upgrade to Product 1. The legacy
  // /api/ai/scripture and /api/ai/deeper endpoints above remain live as a
  // rollback fallback during the soft-launch window (see Stage A PR).

  /**
   * GET /api/ai/ask?question=...&topicHint=Anxiety
   * GET on purpose (iframe sandbox fetch restrictions can block POST).
   * topicHint is optional and treated as soft context only — the question
   * is the primary signal.
   */
  app.get("/api/ai/ask", anonymousQuestionLimiter, authenticatedQuestionQuota, crisisSafetyCheck, async (req, res) => {
    const question  = String(req.query.question  || "").trim();
    const topicHint = String(req.query.topicHint || "").trim();
    if (!question) return res.status(400).json({ error: "question is required" });
    if (!isV2Configured()) {
      return res.status(503).json({ error: "AI v2 not configured", detail: "ANTHROPIC_API_KEY is not set" });
    }
    try {
      const result = await queueAnthropic(res, () => askV2({ question, topicHint }));
      if (!result) return;
      res.json(result);
    } catch (err: any) {
      console.error("AI v2 ask error:", err.message);
      res.status(500).json({ error: "AI response failed", detail: err.message });
    }
  });

  /**
   * GET /api/ai/passage?originalQuestion=...&passageRef=Philippians+4:6
   * Drill-down: focused answer on a specific cited passage, in the
   * context of the user's original question.
   */
  app.get("/api/ai/passage", anonymousQuestionLimiter, authenticatedQuestionQuota, async (req, res) => {
    const originalQuestion = String(req.query.originalQuestion || "").trim();
    const passageRef       = String(req.query.passageRef       || "").trim();
    if (!originalQuestion || !passageRef) {
      return res.status(400).json({ error: "originalQuestion and passageRef are required" });
    }
    if (!isV2Configured()) {
      return res.status(503).json({ error: "AI v2 not configured", detail: "ANTHROPIC_API_KEY is not set" });
    }
    try {
      const result = await queueAnthropic(res, () => drillDownV2({ originalQuestion, passageRef }));
      if (!result) return;
      res.json(result);
    } catch (err: any) {
      console.error("AI v2 passage error:", err.message);
      res.status(500).json({ error: "AI response failed", detail: err.message });
    }
  });

  // ─── Church Onboarding ─────────────────────────────────────────────────────

  /**
   * POST /api/onboard
   * Create a new church from the onboarding form and notify Ryan.
   * Public — no auth required (churches sign themselves up).
   */
  app.post("/api/onboard", async (req, res) => {
    try {
      const {
        churchName, city, state, denomination, size, website,
        pastorFirstName, pastorLastName, email, phone,
        primaryColor, logoUrl,
      } = req.body;

      if (!churchName || !email) {
        return res.status(400).json({ error: "churchName and email are required" });
      }

      const location = [city, state].filter(Boolean).join(", ");

      // Create church in DB
      const church = storage.createChurch({
        name: churchName,
        location,
        denomination: denomination || "",
        logoUrl: logoUrl || "",
        primaryColor: primaryColor || "#7B4A1E",
        sendgridApiKey: "",
        sendgridFromEmail: email,
        status: "active",
      });

      // Log activity
      storage.createActivity({
        churchId: church.id,
        type: "church_onboarded",
        description: `${churchName} joined My Shepherd via the onboarding form`,
        createdAt: new Date().toISOString(),
        meta: JSON.stringify({ pastor: `${pastorFirstName} ${pastorLastName}`, email, phone, size }),
      });

      // Send internal notification: env vars first, fall back to legacy church-row
      try {
        const notifyApiKey = process.env.SENDGRID_API_KEY || storage.getChurch(1)?.sendgridApiKey;
        if (notifyApiKey) {
          const sgConfig = {
            apiKey: notifyApiKey,
            fromEmail: process.env.SENDGRID_FROM_EMAIL || "hello@myshepherdapp.church",
            fromName: process.env.SENDGRID_FROM_NAME || "My Shepherd",
          };
          const notifyHtml = `
            <h2>New Church Signup 🎉</h2>
            <p><strong>${churchName}</strong> just signed up via the My Shepherd onboarding page.</p>
            <table style="border-collapse:collapse;width:100%;">
              <tr><td style="padding:6px 12px;border:1px solid #eee;"><strong>Pastor</strong></td><td style="padding:6px 12px;border:1px solid #eee;">${pastorFirstName} ${pastorLastName}</td></tr>
              <tr><td style="padding:6px 12px;border:1px solid #eee;"><strong>Email</strong></td><td style="padding:6px 12px;border:1px solid #eee;">${email}</td></tr>
              <tr><td style="padding:6px 12px;border:1px solid #eee;"><strong>Phone</strong></td><td style="padding:6px 12px;border:1px solid #eee;">${phone || "—"}</td></tr>
              <tr><td style="padding:6px 12px;border:1px solid #eee;"><strong>Location</strong></td><td style="padding:6px 12px;border:1px solid #eee;">${location || "—"}</td></tr>
              <tr><td style="padding:6px 12px;border:1px solid #eee;"><strong>Denomination</strong></td><td style="padding:6px 12px;border:1px solid #eee;">${denomination || "—"}</td></tr>
              <tr><td style="padding:6px 12px;border:1px solid #eee;"><strong>Size</strong></td><td style="padding:6px 12px;border:1px solid #eee;">${size || "—"}</td></tr>
              <tr><td style="padding:6px 12px;border:1px solid #eee;"><strong>Website</strong></td><td style="padding:6px 12px;border:1px solid #eee;">${website || "—"}</td></tr>
              <tr><td style="padding:6px 12px;border:1px solid #eee;"><strong>Church ID</strong></td><td style="padding:6px 12px;border:1px solid #eee;">#${church.id}</td></tr>
            </table>
            <p style="margin-top:16px;">Log in to the <a href="https://www.perplexity.ai/computer/a/shepherd-admin-dist-public-is81K7zgQUqH6EjYmOaVOQ">admin dashboard</a> to view their profile.</p>
          `;

          await sgSendMail(
            sgConfig,
            {
              to: process.env.INTERNAL_NOTIFY_EMAIL || "admin@barabove.app",
              subject: `New Church Signup: ${churchName}`,
              html: notifyHtml,
              categories: ["church-signup-notification"],
            },
          );
        }
      } catch (emailErr: any) {
        console.error("Notification email failed (non-fatal):", emailErr.message);
      }

      res.json({ ok: true, churchId: church.id, message: "Church created successfully" });
    } catch (err: any) {
      console.error("Onboard error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Churches
  app.get("/api/churches", (req, res) => {
    res.json(storage.getChurches());
  });

  // Search/nearby MUST come before /:id to avoid matching "search" as an ID
  app.get("/api/churches/search", (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json([]);
    const results = storage.searchChurches(q);
    res.json(results);
  });

  app.get("/api/churches/nearby", (req, res) => {
    const lat = parseFloat(String(req.query.lat || "0"));
    const lng = parseFloat(String(req.query.lng || "0"));
    if (!lat || !lng) return res.json([]);
    const results = storage.getChurchesByLocation(lat, lng, 25);
    res.json(results);
  });

  app.get("/api/churches/:id", (req, res) => {
    const church = storage.getChurch(Number(req.params.id));
    if (!church) return res.status(404).json({ error: "Not found" });
    res.json(church);
  });

  app.patch("/api/churches/:id", (req, res) => {
    const updated = storage.updateChurch(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  // Members
  app.get("/api/churches/:churchId/members", (req, res) => {
    res.json(storage.getMembers(Number(req.params.churchId)));
  });

  app.post("/api/churches/:churchId/members", async (req, res) => {
    const parsed = insertMemberSchema.safeParse({ ...req.body, churchId: Number(req.params.churchId) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const member = storage.createMember(parsed.data);
    storage.createActivity({
      churchId: Number(req.params.churchId),
      type: "member_joined",
      description: `${member.firstName} ${member.lastName} joined as a ${member.segment.replace("_", " ")}`,
      createdAt: new Date().toISOString(),
      meta: JSON.stringify({ memberId: member.id }),
    });

    // Auto-sync to SendGrid if church is connected
    const church = storage.getChurch(Number(req.params.churchId));
    if (church?.sendgridApiKey && church?.sendgridFromEmail) {
      const config: SendGridConfig = {
        apiKey: church.sendgridApiKey,
        fromEmail: church.sendgridFromEmail,
        fromName: church.name,
      };
      syncMember(config, church.id, {
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        segment: member.segment,
        phone: member.phone,
        signupDate: member.joinedAt,
        lastEngagementDate: member.lastEngaged,
        homeZip: member.homeZip,
      }).catch(err => console.error("SendGrid sync error:", err));
    }

    res.json(member);
  });

  app.patch("/api/members/:id", async (req, res) => {
    const existing = storage.getMember(Number(req.params.id));
    const updated = storage.updateMember(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });

    // Re-sync contact if segment changed (SendGrid doesn't use tags — just re-upsert)
    if (req.body.segment && existing && existing.segment !== req.body.segment) {
      const church = storage.getChurch(updated.churchId);
      if (church?.sendgridApiKey && church?.sendgridFromEmail) {
        const config: SendGridConfig = {
          apiKey: church.sendgridApiKey,
          fromEmail: church.sendgridFromEmail,
          fromName: church.name,
        };
        syncMember(config, church.id, {
          email: updated.email,
          firstName: updated.firstName,
          lastName: updated.lastName,
          segment: req.body.segment,
          phone: updated.phone,
          signupDate: updated.joinedAt,
          lastEngagementDate: updated.lastEngaged,
          homeZip: updated.homeZip,
        }).catch(err => console.error("SendGrid re-sync error:", err));
      }
    }

    res.json(updated);
  });

  app.delete("/api/members/:id", async (req, res) => {
    const member = storage.getMember(Number(req.params.id));
    storage.deleteMember(Number(req.params.id));

    // Remove from SendGrid contacts
    if (member) {
      const church = storage.getChurch(member.churchId);
      if (church?.sendgridApiKey && church?.sendgridFromEmail) {
        const config: SendGridConfig = {
          apiKey: church.sendgridApiKey,
          fromEmail: church.sendgridFromEmail,
          fromName: church.name,
        };
        removeMember(config, member.email)
          .catch(err => console.error("SendGrid remove error:", err));
      }
    }

    res.json({ success: true });
  });

  // Campaigns
  app.get("/api/churches/:churchId/campaigns", (req, res) => {
    res.json(storage.getCampaigns(Number(req.params.churchId)));
  });

  app.post("/api/churches/:churchId/campaigns", (req, res) => {
    const parsed = insertCampaignSchema.safeParse({ ...req.body, churchId: Number(req.params.churchId) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const campaign = storage.createCampaign(parsed.data);
    storage.createActivity({
      churchId: Number(req.params.churchId),
      type: "campaign_scheduled",
      description: `"${campaign.name}" was created`,
      createdAt: new Date().toISOString(),
      meta: JSON.stringify({ campaignId: campaign.id }),
    });
    res.json(campaign);
  });

  app.patch("/api/campaigns/:id", (req, res) => {
    const updated = storage.updateCampaign(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/campaigns/:id", (req, res) => {
    storage.deleteCampaign(Number(req.params.id));
    res.json({ success: true });
  });

  // Sequences
  app.get("/api/churches/:churchId/sequences", (req, res) => {
    res.json(storage.getSequences(Number(req.params.churchId)));
  });

  app.patch("/api/sequences/:id", (req, res) => {
    const updated = storage.updateSequence(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  // Activities
  app.get("/api/churches/:churchId/activities", (req, res) => {
    res.json(storage.getActivities(Number(req.params.churchId), 20));
  });

  // Stats
  app.get("/api/churches/:churchId/stats", (req, res) => {
    const churchId = Number(req.params.churchId);
    const allMembers = storage.getMembers(churchId);
    const allCampaigns = storage.getCampaigns(churchId);
    const sentCampaigns = allCampaigns.filter(c => c.status === "sent");
    const totalRecipients = sentCampaigns.reduce((sum, c) => sum + c.recipients, 0);
    const totalOpens = sentCampaigns.reduce((sum, c) => sum + c.opens, 0);
    const totalClicks = sentCampaigns.reduce((sum, c) => sum + c.clicks, 0);

    const segmentCounts = allMembers.reduce((acc: Record<string, number>, m) => {
      acc[m.segment] = (acc[m.segment] || 0) + 1;
      return acc;
    }, {});

    res.json({
      totalMembers: allMembers.length,
      activeMembers: allMembers.filter(m => m.segment !== "inactive").length,
      newThisMonth: allMembers.filter(m => {
        const joined = new Date(m.joinedAt);
        const now = new Date();
        return joined.getMonth() === now.getMonth() && joined.getFullYear() === now.getFullYear();
      }).length,
      totalCampaignsSent: sentCampaigns.length,
      avgOpenRate: totalRecipients > 0 ? Math.round((totalOpens / totalRecipients) * 100) : 0,
      avgClickRate: totalRecipients > 0 ? Math.round((totalClicks / totalRecipients) * 100) : 0,
      segmentCounts,
      scheduledCampaigns: allCampaigns.filter(c => c.status === "scheduled").length,
      draftCampaigns: allCampaigns.filter(c => c.status === "draft").length,
    });
  });

  // ─── Church Onboarding ──────────────────────────────────────────────────────

  /**
   * POST /api/onboard
   * Public endpoint — creates a new church from the signup form.
   * SendGrid credentials are left blank; admin adds them via Settings later.
   */
  app.post("/api/onboard", (req, res) => {
    try {
      const {
        name, location, denomination, primaryColor, logoUrl,
        pastorName, email, phone, size, website,
      } = req.body;

      if (!name || !email) {
        return res.status(400).json({ error: "Church name and email are required" });
      }

      const church = storage.createChurch({
        name:              name.trim(),
        location:          location?.trim() || "",
        denomination:      denomination?.trim() || "Non-denominational",
        primaryColor:      primaryColor || "#7B4A1E",
        logoUrl:           logoUrl?.trim() || "",
        sendgridApiKey:    "",
        sendgridFromEmail: "",
        status:            "active",
      });

      // Log activity
      storage.createActivity({
        churchId: church.id,
        type: "member_joined",
        description: `${name} signed up via onboarding form`,
        createdAt: new Date().toISOString(),
        meta: JSON.stringify({ pastorName, email, phone, size, website }),
      });

      res.json(church);
    } catch (err: any) {
      console.error("Onboard error:", err);
      res.status(500).json({ error: err.message || "Failed to create church" });
    }
  });

  // ─── SendGrid Routes ───────────────────────────────────────────────────────
  // Phase A note: new routes use the /api/email/* prefix. The legacy
  // /api/sendgrid/* and /api/churches/:id/sendgrid/* routes remain for
  // backwards-compat with the existing admin UI. They will be deprecated in
  // Phase B once the UI moves to the new paths.

  /**
   * GET /api/email/status
   * Returns the email module's runtime flags so the admin UI can show
   * "Automation: OFF" / "Dry Run" banners.
   */
  app.get("/api/email/status", (_req, res) => {
    res.json({
      automationEnabled: emailConfig.automationEnabled,
      dryRun: emailConfig.dryRun,
      webhookConfigured: !!emailConfig.webhookPublicKey,
      appUrl: emailConfig.appUrl,
      // Phase B additions
      bounceLimits: {
        hard: emailConfig.hardBounceLimit,
        soft: emailConfig.softBounceLimit,
      },
      segmentation: {
        dormantAfterDays: emailConfig.dormantAfterDays,
        inactiveAfterDays: emailConfig.inactiveAfterDays,
        newWindowDays: emailConfig.newWindowDays,
      },
      // Phase B.5 additions
      founderDigest: {
        to: emailConfig.founderDigestTo,
        schedule: emailConfig.founderDigestCronSchedule,
        timezone: emailConfig.founderDigestCronTz,
      },
      deactivationRestoreEnabled: emailConfig.deactivationRestoreEnabled,
      crons: listEmailCrons(),
    });
  });

  // ─── Phase B.5: deactivations dashboard endpoints ────────────────

  /**
   * GET /api/email/deactivations
   * Founder dashboard data source. Query params:
   *   ?since=<iso>    — only rows with deactivatedAt >= this ISO timestamp
   *   ?reason=<cat>   — hard_bounce | soft_bounce | unsubscribe | spam_report | other
   *   ?donorsOnly=1   — only donor deactivations (highest-priority review)
   *   ?limit=<n>      — max rows, default 200
   */
  app.get("/api/email/deactivations", (req, res) => {
    const filters: DeactivationListFilters = {};
    if (typeof req.query.since === "string") filters.sinceIso = req.query.since;
    if (typeof req.query.reason === "string") {
      filters.reasonCategory = req.query.reason as DeactivationListFilters["reasonCategory"];
    }
    if (req.query.donorsOnly === "1" || req.query.donorsOnly === "true") {
      filters.donorsOnly = true;
    }
    if (typeof req.query.limit === "string") {
      const n = parseInt(req.query.limit, 10);
      if (Number.isFinite(n)) filters.limit = n;
    }
    const rows = listDeactivations(filters);
    const summary = buildDigestSummary();
    res.json({
      ok: true,
      restoreEnabled: emailConfig.deactivationRestoreEnabled,
      summary: {
        windowFromIso: summary.windowFromIso,
        windowToIso:   summary.windowToIso,
        newInWindow:   summary.newDeactivations.length,
        donorsInWindow: summary.donorDeactivations.length,
        totalBacklog:  summary.totalDeactivated,
        byReason:      summary.byReason,
      },
      rows,
    });
  });

  /**
   * POST /api/email/deactivations/:id/restore
   * Clears deactivatedAt + reason, resets bounceCount, re-syncs the contact
   * to SendGrid. Gated by EMAIL_DEACTIVATION_RESTORE_ENABLED.
   * Body: { note?: string }
   */
  app.post("/api/email/deactivations/:id/restore", async (req, res) => {
    const memberId = parseInt(req.params.id, 10);
    if (!Number.isFinite(memberId)) {
      return res.status(400).json({ ok: false, error: "Invalid member id" });
    }
    const note = typeof req.body?.note === "string" ? req.body.note : "";
    try {
      const result = await restoreMember(memberId, note);
      if (!result.ok) {
        const status = result.reason === "restore_disabled" ? 409
                     : result.reason === "not_found"        ? 404
                     : result.reason === "not_deactivated"  ? 409
                     : 500;
        return res.status(status).json(result);
      }
      return res.json(result);
    } catch (err: any) {
      console.error("[email/deactivations/restore] failed:", err);
      return res.status(500).json({ ok: false, error: err?.message || "unknown" });
    }
  });

  /**
   * POST /api/email/founder-digest/preview
   * Renders the digest HTML + subject WITHOUT sending it. Useful for tuning.
   */
  app.post("/api/email/founder-digest/preview", (_req, res) => {
    const summary = buildDigestSummary();
    const { subject, html } = renderFounderDigest(summary);
    res.json({ ok: true, subject, html, summary });
  });

  /**
   * POST /api/email/founder-digest/run
   * Manually trigger a digest send (honors automation kill-switch).
   */
  app.post("/api/email/founder-digest/run", async (_req, res) => {
    try {
      const result = await runFounderDigestNow();
      if (!result.ran) return res.status(409).json({ ok: false, ...result });
      return res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[email/founder-digest/run] failed:", err);
      return res.status(500).json({ ok: false, error: err?.message || "unknown" });
    }
  });

  /**
   * POST /api/email/donors/recompute
   * Manually trigger the donor-flag safety-net recompute.
   */
  app.post("/api/email/donors/recompute", (_req, res) => {
    try {
      const result = recomputeDonors();
      return res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[email/donors/recompute] failed:", err);
      return res.status(500).json({ ok: false, error: err?.message || "unknown" });
    }
  });

  /**
   * POST /api/email/webhook
   * SendGrid event webhook receiver. Signature verification happens inside
   * the handler (Ed25519). The handler responds 200 even on partial failure
   * so SendGrid doesn't retry-storm — individual event errors are logged and
   * the audit row is still written.
   *
   * NOTE: Raw-body middleware for this route is registered in server/index.ts
   * BEFORE express.json(). Do not add other body parsers here.
   */
  app.post("/api/email/webhook", handleSendGridWebhook);

  /**
   * POST /api/email/segmentation/run
   * Manually triggers a segmentation recompute (same code path as the
   * nightly cron). Useful for testing thresholds and previewing the next
   * run's effect. Respects EMAIL_AUTOMATION_ENABLED — returns 409 if off.
   */
  app.post("/api/email/segmentation/run", async (_req, res) => {
    try {
      const result = await runSegmentationNow();
      if (!result.ran) {
        return res.status(409).json({ ok: false, reason: result.reason });
      }
      return res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[email/segmentation/run] failed:", err);
      return res.status(500).json({ ok: false, error: err?.message || "unknown" });
    }
  });

  /**
   * POST /api/email/churches/:churchId/provision
   * Idempotently provisions SendGrid state for a church:
   *   - account custom fields
   *   - per-church marketing contacts list
   *   - verified sender lookup (writes senderId to the church row)
   * Safe to call anytime; first run sets things up, subsequent runs no-op.
   */
  app.post("/api/email/churches/:churchId/provision", async (req, res) => {
    const churchId = Number(req.params.churchId);
    const result = await provisionChurch(churchId);
    res.status(result.success ? 200 : 400).json(result);
  });

  /**
   * POST /api/sendgrid/test
   * Test API key + from email before saving.
   * Body: { apiKey, fromEmail }
   */
  app.post("/api/sendgrid/test", async (req, res) => {
    const { apiKey, fromEmail } = req.body;
    if (!apiKey || !fromEmail) {
      return res.status(400).json({ success: false, error: "apiKey and fromEmail are required" });
    }
    const result = await testConnection({ apiKey, fromEmail });
    res.json(result);
  });

  /**
   * POST /api/churches/:churchId/sendgrid/sync
   * Push ALL members of a church to SendGrid Marketing Contacts.
   */
  app.post("/api/churches/:churchId/sendgrid/sync", async (req, res) => {
    const churchId = Number(req.params.churchId);
    const church = storage.getChurch(churchId);
    if (!church) return res.status(404).json({ error: "Church not found" });
    if (!church.sendgridApiKey || !church.sendgridFromEmail) {
      return res.status(400).json({ error: "SendGrid not configured for this church" });
    }

    const members = storage.getMembers(churchId);
    const config: SendGridConfig = {
      apiKey: church.sendgridApiKey,
      fromEmail: church.sendgridFromEmail,
      fromName: church.name,
    };

    const result = await syncAllMembers(config, churchId, members.map(m => ({
      email: m.email,
      firstName: m.firstName,
      lastName: m.lastName,
      segment: m.segment,
      phone: m.phone,
      signupDate: m.joinedAt,
      lastEngagementDate: m.lastEngaged,
      homeZip: m.homeZip,
    })));

    if (result.success) {
      storage.createActivity({
        churchId,
        type: "email_sent",
        description: `Synced ${result.synced} members to SendGrid`,
        createdAt: new Date().toISOString(),
        meta: JSON.stringify({ synced: result.synced, failed: result.failed, jobId: result.jobId }),
      });
    }

    res.json(result);
  });

  /**
   * POST /api/campaigns/:id/sendgrid/push
   * Create a SendGrid Single Send and optionally schedule it.
   * Body: { scheduledAt? } (ISO string override)
   */
  app.post("/api/campaigns/:id/sendgrid/push", async (req, res) => {
    const campaign = storage.getCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const church = storage.getChurch(campaign.churchId);
    if (!church) return res.status(404).json({ error: "Church not found" });
    if (!church.sendgridApiKey || !church.sendgridFromEmail) {
      return res.status(400).json({ error: "SendGrid not configured. Add your API key in Settings." });
    }

    const config: SendGridConfig = {
      apiKey: church.sendgridApiKey,
      fromEmail: church.sendgridFromEmail,
      fromName: church.name,
    };

    // Build email HTML based on campaign type
    let htmlBody = campaign.bodyHtml;
    if (!htmlBody || htmlBody.trim() === "") {
      if (campaign.type === "devotional" && campaign.bibleTopicTag) {
        htmlBody = buildDevotionalEmailHtml({
          churchName: church.name,
          primaryColor: church.primaryColor || "#7B4A1E",
          bibleTopicTag: campaign.bibleTopicTag,
        });
      } else if (campaign.type === "onboarding") {
        htmlBody = buildWelcomeEmailHtml({
          churchName: church.name,
          primaryColor: church.primaryColor || "#7B4A1E",
          firstName: "{{first_name}}",
        });
      } else {
        htmlBody = `<html><body style="font-family:Arial,sans-serif;padding:32px;color:#333;">
          <h2>${campaign.subject}</h2>
          <p>From ${church.name}</p>
          <p style="font-size:12px;color:#999;"><a href="{{unsubscribe}}">Unsubscribe</a></p>
        </body></html>`;
      }
    }

    // Use scheduledAt from request body (UI override) or campaign's stored value
    const scheduledAt = req.body.scheduledAt || campaign.scheduledAt || undefined;

    const result = await createCampaign(config, church.id, {
      subject:     campaign.subject,
      previewText: campaign.previewText || "",
      fromName:    church.name,
      fromEmail:   church.sendgridFromEmail,
      htmlBody,
      scheduledAt,
    });

    if (result.success && result.campaignId) {
      // Store SendGrid Single Send ID in campaign meta
      const currentMeta = (() => {
        try { return JSON.parse(campaign.meta as string || "{}"); } catch { return {}; }
      })();
      storage.updateCampaign(campaign.id, {
        status: scheduledAt ? "scheduled" : "draft",
        meta: JSON.stringify({ ...currentMeta, sendgridCampaignId: result.campaignId }),
      });
      storage.createActivity({
        churchId: campaign.churchId,
        type: "campaign_scheduled",
        description: `"${campaign.name}" pushed to SendGrid${
          scheduledAt ? ` — scheduled for ${new Date(scheduledAt).toLocaleDateString()}` : " as draft"
        }`,
        createdAt: new Date().toISOString(),
        meta: JSON.stringify({ sendgridCampaignId: result.campaignId }),
      });
    }

    res.json({ ...result, scheduled: !!scheduledAt });
  });

  /**
   * POST /api/campaigns/:id/sendgrid/send
   * Immediately send a campaign that was pushed to SendGrid.
   * Body: { sendgridCampaignId }
   */
  app.post("/api/campaigns/:id/sendgrid/send", async (req, res) => {
    const { sendgridCampaignId } = req.body;
    if (!sendgridCampaignId) {
      return res.status(400).json({ error: "sendgridCampaignId is required" });
    }

    const campaign = storage.getCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const church = storage.getChurch(campaign.churchId);
    if (!church?.sendgridApiKey || !church?.sendgridFromEmail) {
      return res.status(400).json({ error: "SendGrid not configured" });
    }

    const config: SendGridConfig = {
      apiKey: church.sendgridApiKey,
      fromEmail: church.sendgridFromEmail,
      fromName: church.name,
    };
    const result = await sendCampaign(config, sendgridCampaignId);

    if (result.success) {
      storage.updateCampaign(campaign.id, { status: "sent", sentAt: new Date().toISOString() });
      storage.createActivity({
        churchId: campaign.churchId,
        type: "email_sent",
        description: `"${campaign.name}" sent via SendGrid`,
        createdAt: new Date().toISOString(),
        meta: JSON.stringify({ sendgridCampaignId }),
      });
    }

    res.json(result);
  });

  /**
   * GET /api/campaigns/:id/sendgrid/stats
   * Pull live stats from SendGrid and update local DB.
   * Query: ?sendgridCampaignId=xxx
   */
  app.get("/api/campaigns/:id/sendgrid/stats", async (req, res) => {
    const sendgridCampaignId = req.query.sendgridCampaignId as string;
    if (!sendgridCampaignId) {
      return res.status(400).json({ error: "sendgridCampaignId query param required" });
    }

    const campaign = storage.getCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const church = storage.getChurch(campaign.churchId);
    if (!church?.sendgridApiKey || !church?.sendgridFromEmail) {
      return res.status(400).json({ error: "SendGrid not configured" });
    }

    const config: SendGridConfig = {
      apiKey: church.sendgridApiKey,
      fromEmail: church.sendgridFromEmail,
      fromName: church.name,
    };
    const report = await getCampaignStats(config, sendgridCampaignId);

    if (report.success) {
      storage.updateCampaign(campaign.id, {
        recipients: report.requests ?? campaign.recipients,
        opens:      report.opens    ?? campaign.opens,
        clicks:     report.clicks   ?? campaign.clicks,
      });
    }

    res.json(report);
  });

  /**
   * GET /api/sendgrid/email-preview
   * Returns rendered HTML preview of an email template.
   * Query: ?churchId=1&campaignId=1
   */
  app.get("/api/sendgrid/email-preview", async (req, res) => {
    const churchId = Number(req.query.churchId);
    const campaignId = Number(req.query.campaignId);
    if (!churchId || !campaignId) {
      return res.status(400).json({ error: "churchId and campaignId required" });
    }

    const church = storage.getChurch(churchId);
    const campaign = storage.getCampaign(campaignId);
    if (!church || !campaign) return res.status(404).json({ error: "Not found" });

    let html = "";
    if (campaign.type === "devotional") {
      html = buildDevotionalEmailHtml({
        churchName: church.name,
        primaryColor: church.primaryColor || "#7B4A1E",
        bibleTopicTag: campaign.bibleTopicTag || "Faith",
      });
    } else {
      html = buildWelcomeEmailHtml({
        churchName: church.name,
        primaryColor: church.primaryColor || "#7B4A1E",
        firstName: "Friend",
      });
    }

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  // ─── Insights (My Shepherd app logging) ─────────────────────────────────────

  /**
   * POST /api/insights/log
   * Log a topic tap or free-form question from the My Shepherd app.
   * Body: { topic, question?, sessionId, churchId?, location? }
   * No auth required — public endpoint, rate-limited by session.
   */
  app.post("/api/insights/log", (req, res) => {
    try {
      const parsed = insertInsightSchema.safeParse({
        topic:      req.body.topic,
        question:   req.body.question   || "",
        sessionId:  req.body.sessionId  || "",
        churchId:   req.body.churchId   ?? null,
        location:   req.body.location   || "",
        verseRef:   req.body.verseRef   || "",
        verseText:  req.body.verseText  || "",
        reflection: req.body.reflection || "",
        createdAt: new Date().toISOString(),
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error });
      const insight = storage.logInsight(parsed.data);
      res.json(insight);
    } catch (err: any) {
      console.error("Insights log error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/insights
   * Per-church insights summary.
   * Query: ?churchId=1&days=30
   */
  app.get("/api/insights", (req, res) => {
    const churchId = req.query.churchId ? Number(req.query.churchId) : undefined;
    const days     = req.query.days     ? Number(req.query.days)     : 30;
    const topTopics = storage.getTopTopics(churchId, days);
    const recentInsights = storage.getInsights(churchId, 50);
    res.json({ topTopics, recentInsights });
  });

  /**
   * GET /api/insights/all
   * Platform-wide aggregated insights (all churches combined).
   * Query: ?days=30
   */
  app.get("/api/insights/all", (req, res) => {
    const days = req.query.days ? Number(req.query.days) : 30;
    const topTopics = storage.getTopTopics(undefined, days);
    const recentInsights = storage.getInsights(undefined, 100);
    res.json({ topTopics, recentInsights });
  });

  /**
   * GET /api/insights/trending
   * Top topics this week — used by My Shepherd app for the trending strip.
   * Query: ?churchId=1 (optional)
   */
  app.get("/api/insights/trending", (req, res) => {
    const churchId = req.query.churchId ? Number(req.query.churchId) : undefined;
    const topTopics = storage.getTopTopics(churchId, 7);
    res.json({ trending: topTopics.slice(0, 5) });
  });

  /**
   * GET /api/insights/qa
   * Q&A admin dashboard — paged, filtered, searchable Q&A log.
   *
   * Access: Admin-only today; architected for Church Admin scoping via
   * ?churchId=... once church accounts ship. Treat the absence of churchId
   * as platform-wide and gate at the UI/auth layer.
   *
   * Query: ?churchId=&days=30&topic=Anxiety&audience=all|signed_in|anon
   *        &search=&questionsOnly=1&limit=50&offset=0
   */
  app.get("/api/insights/qa", (req, res) => {
    try {
      const churchId  = req.query.churchId != null && req.query.churchId !== "" ? Number(req.query.churchId) : undefined;
      const days      = req.query.days != null ? Number(req.query.days) : 30;
      const topic     = (req.query.topic as string) || undefined;
      const audience  = ((req.query.audience as string) || "all") as "all" | "signed_in" | "anon";
      const search    = (req.query.search as string) || undefined;
      const questionsOnly = req.query.questionsOnly === "1" || req.query.questionsOnly === "true";
      const limit     = req.query.limit  != null ? Number(req.query.limit)  : 50;
      const offset    = req.query.offset != null ? Number(req.query.offset) : 0;

      const result = storage.getQA({
        churchId, days, topic, audience, search, questionsOnly, limit, offset,
      });
      const topTopics = storage.getTopTopics(churchId, days);
      res.json({ ...result, topTopics });
    } catch (err: any) {
      console.error("Insights QA error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Discover — cross-church anonymized questions feed ────────────────────
  // Auth: same admin bearer token as the rest of /api (requireAuth above). The
  // dashboard has a single shared admin token today, so there is no per-admin
  // identity to key curation on — all curation is stored under DISCOVER_ADMIN_ID.
  // The curated_questions schema (admin_user_id + unique constraint) is already
  // multi-admin ready; when per-admin auth lands, derive this from the session.
  const DISCOVER_ADMIN_ID = "admin";
  const DISCOVER_RANGES = new Set(["7d", "30d", "90d"]);
  const DISCOVER_SORTS = new Set(["recent", "similar", "longest"]);

  /**
   * GET /api/discover/questions
   * Category-balanced (default) or filtered/paginated anonymized feed of every
   * question asked across My Shepherd. NEVER returns session_id, church_id,
   * location, or any other identifying field — see storage.getDiscoverQuestions.
   * Query: ?range=7d|30d|90d&category=&search=&sort=recent|similar|longest
   *        &page=1&curated_only=false
   */
  app.get("/api/discover/questions", (req, res) => {
    try {
      const rangeRaw = String(req.query.range || "30d");
      const range = (DISCOVER_RANGES.has(rangeRaw) ? rangeRaw : "30d") as "7d" | "30d" | "90d";
      const sortRaw = String(req.query.sort || "recent");
      const sort = (DISCOVER_SORTS.has(sortRaw) ? sortRaw : "recent") as "recent" | "similar" | "longest";
      const category = req.query.category ? String(req.query.category) : undefined;
      const search = req.query.search ? String(req.query.search) : undefined;
      const pageRaw = req.query.page != null ? Number(req.query.page) : 1;
      const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
      const curatedOnly = req.query.curated_only === "1" || req.query.curated_only === "true";

      const result = storage.getDiscoverQuestions({
        range, category, search, sort, page, curatedOnly, adminUserId: DISCOVER_ADMIN_ID,
      });
      res.json(result);
    } catch (err: any) {
      console.error("Discover questions error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/discover/curate  — body { question_id } — stars a question for
   * the current admin. Idempotent (unique constraint makes re-star a no-op).
   */
  app.post("/api/discover/curate", (req, res) => {
    try {
      const parsed = z.object({ question_id: z.number().int().positive() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "question_id (positive integer) is required" });
      storage.addCuration(DISCOVER_ADMIN_ID, parsed.data.question_id);
      res.json({ ok: true, question_id: parsed.data.question_id, curated: true });
    } catch (err: any) {
      console.error("Discover curate error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/discover/curate/:question_id — unstars a question for the
   * current admin. Idempotent (deleting a non-curated row is a no-op).
   */
  app.delete("/api/discover/curate/:question_id", (req, res) => {
    try {
      const questionId = Number(req.params.question_id);
      if (!Number.isInteger(questionId) || questionId <= 0) {
        return res.status(400).json({ error: "question_id must be a positive integer" });
      }
      storage.removeCuration(DISCOVER_ADMIN_ID, questionId);
      res.json({ ok: true, question_id: questionId, curated: false });
    } catch (err: any) {
      console.error("Discover uncurate error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/discover/curated — returns the current admin's curated question ids.
   */
  app.get("/api/discover/curated", (_req, res) => {
    try {
      res.json({ curated: storage.getCuratedQuestionIds(DISCOVER_ADMIN_ID) });
    } catch (err: any) {
      console.error("Discover curated error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/traffic/snapshot
   * Record one marketing-traffic data point. The agent calls this whenever the
   * founder pastes a new Cloudflare unique-visitor number in chat. Admin-only
   * (the requireAuth middleware gates anything not in PUBLIC).
   *
   * Body: { source: string, metric: string, value: number, note?: string,
   *         recordedAt?: ISO string (defaults to now) }
   */
  app.post("/api/traffic/snapshot", (req, res) => {
    try {
      const body = req.body || {};
      const source = String(body.source || "").trim();
      const metric = String(body.metric || "").trim();
      const value  = Number(body.value);
      const note   = String(body.note || "").trim();
      const recordedAt = body.recordedAt ? String(body.recordedAt) : new Date().toISOString();

      if (!source || !metric || !Number.isFinite(value)) {
        return res.status(400).json({ error: "source, metric, and numeric value are required" });
      }
      const row = storage.createTrafficSnapshot({ source, metric, value, note, recordedAt });
      res.json({ ok: true, snapshot: row });
    } catch (err: any) {
      console.error("Traffic snapshot error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/traffic/latest
   * Returns the latest snapshot for a (source, metric) pair plus the prior
   * snapshot (so the UI can show delta) and a short history.
   *
   * Query: ?source=cloudflare&metric=uniques_30d&history=14
   */
  app.get("/api/traffic/latest", (req, res) => {
    try {
      const source = (req.query.source as string) || "cloudflare";
      const metric = (req.query.metric as string) || "uniques_30d";
      const historyLimit = req.query.history != null ? Number(req.query.history) : 14;

      const history = storage.getTrafficHistory(source, metric, historyLimit);
      const latest  = history[0];
      const prior   = history[1];
      res.json({
        source,
        metric,
        latest: latest || null,
        prior:  prior  || null,
        history,
      });
    } catch (err: any) {
      console.error("Traffic latest error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/traffic/refresh
   * Admin-only. Pull the Cloudflare 30-day unique-visitor count right now and,
   * on success, write a fresh snapshot. Used to update the Overview tile on
   * demand (e.g. before a demo) without waiting for the daily cron. Returns
   * { ran:false, reason } when credentials are missing or the fetch failed.
   */
  app.post("/api/traffic/refresh", async (_req, res) => {
    try {
      const result = await refreshCloudflareTraffic();
      res.json(result);
    } catch (err: any) {
      console.error("Traffic refresh error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Affiliations (link anonymous session to a church) ────────────────────────

  /**
   * POST /api/affiliations
   * Link an anonymous session to a church.
   * Body: { sessionId, churchId, firstName?, email?, location? }
   */
  app.post("/api/affiliations", (req, res) => {
    try {
      const parsed = insertAffiliationSchema.safeParse({
        sessionId: req.body.sessionId || "",
        churchId:  Number(req.body.churchId),
        firstName: req.body.firstName || "",
        email:     req.body.email     || "",
        location:  req.body.location  || "",
        createdAt: new Date().toISOString(),
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error });
      const affiliation = storage.createAffiliation(parsed.data);
      res.json(affiliation);
    } catch (err: any) {
      console.error("Affiliation error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/affiliations/:sessionId
   * Look up the church affiliation for a given session.
   */
  app.get("/api/affiliations/:sessionId", (req, res) => {
    const aff = storage.getAffiliation(req.params.sessionId);
    if (!aff) return res.status(404).json({ error: "Not found" });
    res.json(aff);
  });

  // ─── Member signups (app first-visit "stay connected" lead-gen) ───────────────

  // Trim, cap at 200 chars, and treat empty as null so an empty submit never
  // overwrites a previously-captured value downstream.
  const normalizeHomeChurch = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim().slice(0, 200) : "";
    return s || null;
  };

  const memberSignupBodySchema = z.object({
    email: z.string().email(),
    zip: z.string().regex(/^\d{5}$/, "zip must be 5 digits"),
    userId: z.coerce.number().int().positive().optional(),
    homeChurchName: z.string().optional(),
  });

  /**
   * POST /api/member-signups
   * Public — captures an email + ZIP from the first-visit modal so we can match
   * the visitor to their church once one near them joins. Upserts on email.
   * Body: { email, zip, userId? }
   */
  app.post("/api/member-signups", (req, res) => {
    try {
      const parsed = memberSignupBodySchema.safeParse({
        email: req.body.email,
        zip: req.body.zip,
        userId: req.body.userId ?? undefined,
        homeChurchName: req.body.homeChurchName ?? undefined,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid email or ZIP", details: parsed.error.flatten() });
      }
      const fwd = req.headers["x-forwarded-for"];
      const ipAddress = (Array.isArray(fwd) ? fwd[0] : (fwd || "").split(",")[0].trim()) || req.ip || "";
      const userAgent = req.headers["user-agent"] || "";
      const { alreadyExisted } = storage.createMemberSignup({
        email: parsed.data.email,
        zipCode: parsed.data.zip,
        userId: parsed.data.userId ?? null,
        homeChurchName: normalizeHomeChurch(parsed.data.homeChurchName),
        ipAddress,
        userAgent,
      });
      res.json({ ok: true, alreadyExisted });
    } catch (err: any) {
      console.error("Member signup error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/member-signups/count
   * Admin (Bearer token) — launch-day signup pickup metric.
   */
  app.get("/api/member-signups/count", (_req, res) => {
    res.json({ count: storage.countMemberSignups() });
  });

  return httpServer;
}
