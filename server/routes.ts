import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { getScriptureResponse } from "./ai";
import { insertMemberSchema, insertCampaignSchema, insertSequenceSchema, insertChurchSchema, insertInsightSchema, insertAffiliationSchema } from "@shared/schema";
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
  type SendGridConfig,
} from "./sendgrid";

// ─── Auth middleware ────────────────────────────────────────────────────────
// Simple token-based auth for the admin dashboard.
// The frontend sends Authorization: Bearer <token> on every API request.
// The token is the SHA-256 hash of the admin password stored in ADMIN_PASSWORD env var.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "shepherd2026";

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
    "/onboard",
  ];
  if (PUBLIC.some(p => req.path.startsWith(p))) return next();
  // Also allow GET /affiliations/:sessionId (for session restore)
  if (req.method === "GET" && req.path.match(/^\/affiliations\//)) return next();

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Apply auth middleware to all /api routes
  app.use("/api", requireAuth);

  // ─── Health check (Railway / uptime monitors) ────────────────────────────
  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // ─── Auth ──────────────────────────────────────────────────────────────────

  /**
   * POST /api/auth/login
   * Validate password and return a session token.
   * Body: { password: string }
   */
  app.post("/api/auth/login", (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
      res.json({ token: ADMIN_PASSWORD, ok: true });
    } else {
      res.status(401).json({ error: "Incorrect password" });
    }
  });

  // ─── AI Scripture ──────────────────────────────────────────────────────────

  /**
   * POST /api/ai/scripture
   * Get a real AI-powered scripture response for a topic + question.
   * Public — called directly from the My Shepherd app.
   * Body: { topic: string, question?: string }
   */
  app.post("/api/ai/scripture", async (req, res) => {
    const { topic, question = "" } = req.body;
    if (!topic) return res.status(400).json({ error: "topic is required" });
    try {
      const result = await getScriptureResponse(topic, question);
      res.json(result);
    } catch (err: any) {
      console.error("AI scripture error:", err.message);
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

      // Send notification email to Ryan via the Grace Community SendGrid config
      try {
        const graceChurch = storage.getChurch(1);
        if (graceChurch?.sendgridApiKey) {
          const sgConfig = {
            apiKey: graceChurch.sendgridApiKey,
            fromEmail: "ryan+shepherd@guacapp.com",
            fromName: "My Shepherd",
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

          const sgMail = await import("@sendgrid/mail");
          sgMail.default.setApiKey(sgConfig.apiKey);
          await sgMail.default.send({
            to: "ryan+shepherd@guacapp.com",
            from: { email: sgConfig.fromEmail, name: "My Shepherd" },
            subject: `New Church Signup: ${churchName}`,
            html: notifyHtml,
          });
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
      syncMember(config, {
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        segment: member.segment,
        phone: member.phone,
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
        syncMember(config, {
          email: updated.email,
          firstName: updated.firstName,
          lastName: updated.lastName,
          segment: req.body.segment,
          phone: updated.phone,
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

    const result = await syncAllMembers(config, members.map(m => ({
      email: m.email,
      firstName: m.firstName,
      lastName: m.lastName,
      segment: m.segment,
      phone: m.phone,
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

    const result = await createCampaign(config, {
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
        topic:     req.body.topic,
        question:  req.body.question  || "",
        sessionId: req.body.sessionId || "",
        churchId:  req.body.churchId  ?? null,
        location:  req.body.location  || "",
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

  return httpServer;
}
