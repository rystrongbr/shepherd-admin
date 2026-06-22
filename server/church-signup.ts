/**
 * Church Prospects landing-page signup handler.
 *
 * Receives form POSTs from the public myshepherdapp.church marketing site and:
 *   1. Writes a row to the "Church Prospects" Notion database
 *   2. Sends an internal notification email to admin@barabove.app
 *
 * Both side effects are best-effort: a Notion failure does not block the email,
 * and an email failure does not block the success response to the user. We do,
 * however, require AT LEAST ONE side-effect to succeed before returning 200,
 * otherwise the lead would be silently dropped.
 *
 * Required env vars:
 *   - NOTION_API_KEY                  (Notion integration token, secret_*)
 *   - CHURCH_PROSPECTS_DATA_SOURCE_ID (Notion data source ID, e.g. 7dae05a0-b272-4bf1-99af-8e4288dc28dc)
 *   - SENDGRID_API_KEY                (existing)
 *   - SENDGRID_FROM_EMAIL             (existing, fallback: hello@myshepherdapp.church)
 *   - INTERNAL_NOTIFY_EMAIL           (existing, fallback: admin@barabove.app)
 */

import type { Express, Request, Response } from "express";
import { sgSendMail } from "./email/sendgrid-client";
import {
  pickWelcomeTemplate,
  escapeHtml,
  VALID_CHURCH_ROLES,
  type ChurchRole,
} from "./email/church-welcome-templates";
import { storage } from "./storage";

const CHURCH_PROSPECTS_DATA_SOURCE_ID =
  process.env.CHURCH_PROSPECTS_DATA_SOURCE_ID || "7dae05a0-b272-4bf1-99af-8e4288dc28dc";

const NOTION_VERSION = "2022-06-28";

type ChurchSignupPayload = {
  churchName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  congregationSize?: string; // one of "<100" | "100-500" | "500-2000" | "2000+"
  location?: string;
  engagementChallenge?: string;
  source?: string;           // defaults to "Landing Page Form"
  role?: ChurchRole;         // "staff" | "member" | "exploring" — drives welcome-email persona
};

const VALID_SIZES = new Set(["<100", "100-500", "500-2000", "2000+"]);
const VALID_SOURCES = new Set(["Landing Page Form", "Manual Entry", "Referral", "Event"]);

function sanitizeString(v: unknown, maxLen = 500): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, maxLen);
}

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Create a page in the Church Prospects Notion database via the REST API.
 * We use fetch (Node 18+) directly so we don't need to add a new dependency.
 */
async function writeToNotion(payload: ChurchSignupPayload & { churchName: string; source: string }): Promise<{ ok: true; pageId: string } | { ok: false; error: string }> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) return { ok: false, error: "NOTION_API_KEY not configured" };

  const properties: Record<string, any> = {
    "Church Name": {
      title: [{ type: "text", text: { content: payload.churchName } }],
    },
  };

  if (payload.contactName) {
    properties["Contact Name"] = {
      rich_text: [{ type: "text", text: { content: payload.contactName } }],
    };
  }
  if (payload.email) {
    properties["Email"] = { email: payload.email };
  }
  if (payload.phone) {
    properties["Phone"] = { phone_number: payload.phone };
  }
  if (payload.congregationSize && VALID_SIZES.has(payload.congregationSize)) {
    properties["Congregation Size"] = { select: { name: payload.congregationSize } };
  }
  if (payload.location) {
    properties["Location"] = {
      rich_text: [{ type: "text", text: { content: payload.location } }],
    };
  }
  if (payload.engagementChallenge) {
    properties["Engagement Challenge"] = {
      rich_text: [{ type: "text", text: { content: payload.engagementChallenge } }],
    };
  }
  if (payload.role && VALID_CHURCH_ROLES.has(payload.role as ChurchRole)) {
    // Notion property "Role" is a Select column with options:
    //   Staff / Leadership, Member / Parishioner, Exploring
    const roleLabel =
      payload.role === "staff"
        ? "Staff / Leadership"
        : payload.role === "member"
        ? "Member / Parishioner"
        : "Exploring";
    properties["Role"] = { select: { name: roleLabel } };
  }
  properties["Source"] = {
    select: { name: VALID_SOURCES.has(payload.source) ? payload.source : "Landing Page Form" },
  };
  properties["Status"] = { status: { name: "Not started" } };

  try {
    const resp = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: CHURCH_PROSPECTS_DATA_SOURCE_ID },
        properties,
      }),
    });

    if (!resp.ok) {
      // Older Notion API versions expect `database_id` parent. Retry once with that
      // shape for compatibility — the data source ID is, in current Notion
      // databases with a single data source, the same value as the database ID is
      // NOT — but the API accepts the data_source_id under database_id as a
      // fallback for backward compatibility.
      const text = await resp.text();
      // Retry as database_id parent
      const retry = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_VERSION,
        },
        body: JSON.stringify({
          parent: { database_id: CHURCH_PROSPECTS_DATA_SOURCE_ID },
          properties,
        }),
      });
      if (!retry.ok) {
        const retryText = await retry.text();
        return { ok: false, error: `Notion ${resp.status}: ${text} | retry ${retry.status}: ${retryText}` };
      }
      const retryJson: any = await retry.json();
      return { ok: true, pageId: retryJson.id };
    }

    const json: any = await resp.json();
    return { ok: true, pageId: json.id };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function sendNotificationEmail(
  payload: ChurchSignupPayload,
  notionPageId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY || storage.getChurch(1)?.sendgridApiKey;
  if (!apiKey) return { ok: false, error: "SENDGRID_API_KEY not configured" };

  const fromEmail = process.env.SENDGRID_FROM_EMAIL || "hello@myshepherdapp.church";
  const fromName = process.env.SENDGRID_FROM_NAME || "My Shepherd";
  const to = process.env.INTERNAL_NOTIFY_EMAIL || "admin@barabove.app";

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;border:1px solid #eee;"><strong>${label}</strong></td><td style="padding:6px 12px;border:1px solid #eee;">${value || "—"}</td></tr>`;

  const notionLink = notionPageId
    ? `<p style="margin-top:16px;"><a href="https://www.notion.so/${notionPageId.replace(/-/g, "")}">View in Notion →</a></p>`
    : `<p style="margin-top:16px;color:#b00;"><strong>Note:</strong> Notion write failed — see server logs.</p>`;

  const html = `
    <h2>New Church Prospect 🙏</h2>
    <p><strong>${payload.churchName}</strong> just submitted the church signup form on myshepherdapp.church.</p>
    <table style="border-collapse:collapse;width:100%;max-width:600px;font-family:Inter,Arial,sans-serif;">
      ${row("Church", payload.churchName || "")}
      ${row("Contact", payload.contactName || "")}
      ${row("Email", payload.email || "")}
      ${row("Phone", payload.phone || "")}
      ${row("Role", payload.role || "")}
      ${row("Congregation Size", payload.congregationSize || "")}
      ${row("Location", payload.location || "")}
      ${row("Engagement Challenge", payload.engagementChallenge || "")}
      ${row("Source", payload.source || "Landing Page Form")}
    </table>
    ${notionLink}
  `;

  const result = await sgSendMail(
    { apiKey, fromEmail, fromName },
    {
      to,
      subject: `New Church Prospect: ${payload.churchName}`,
      html,
      categories: ["church-prospect-signup"],
    },
  );
  return { ok: result.success, error: result.error };
}

/**
 * Send the persona-routed welcome email to the form submitter.
 * Sent personally as Ryan Armstrong <ryan@myshepherdapp.church> regardless
 * of SENDGRID_FROM_EMAIL, so the recipient sees a founder reply, not a brand.
 * Best-effort — a failure here is logged but doesn't block the success response.
 */
async function sendChurchWelcomeEmail(
  payload: ChurchSignupPayload,
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const apiKey = process.env.SENDGRID_API_KEY || storage.getChurch(1)?.sendgridApiKey;
  if (!apiKey) return { ok: false, error: "SENDGRID_API_KEY not configured" };
  if (!payload.email) return { ok: false, skipped: true, error: "No recipient email on submission" };

  // Founder-led envelope: locked to ryan@ regardless of the brand FROM env var.
  // If FOUNDER_FROM_EMAIL is set we use it as an override hook for staging.
  const fromEmail = process.env.FOUNDER_FROM_EMAIL || "ryan@myshepherdapp.church";
  const fromName = "Ryan Armstrong";

  const contactName = payload.contactName || "friend";
  const churchName = payload.churchName || "your church";

  const { html: htmlTpl, text: textTpl, subjectSuffix } = pickWelcomeTemplate(payload.role);

  const html = htmlTpl
    .replace(/\{\{contactName\}\}/g, escapeHtml(contactName))
    .replace(/\{\{churchName\}\}/g, escapeHtml(churchName));

  const text = textTpl
    .replace(/\{\{contactName\}\}/g, contactName)
    .replace(/\{\{churchName\}\}/g, churchName);

  const subject = `My Shepherd — welcome, ${churchName} (${subjectSuffix})`;

  const result = await sgSendMail(
    { apiKey, fromEmail, fromName },
    {
      to: payload.email,
      replyTo: "ryan@myshepherdapp.church",
      subject,
      html,
      text,
      categories: [
        "church-prospect-welcome",
        `church-prospect-welcome-${payload.role || "unknown"}`,
      ],
    },
  );
  return { ok: result.success, error: result.error };
}

export function registerChurchSignupRoute(app: Express) {
  app.post("/api/church-signup", async (req: Request, res: Response) => {
    try {
      const rawRole = sanitizeString(req.body?.role, 20).toLowerCase();
      const role: ChurchRole | undefined = VALID_CHURCH_ROLES.has(rawRole as ChurchRole)
        ? (rawRole as ChurchRole)
        : undefined;

      const body: ChurchSignupPayload = {
        churchName: sanitizeString(req.body?.churchName, 200),
        contactName: sanitizeString(req.body?.contactName, 200),
        email: sanitizeString(req.body?.email, 200).toLowerCase(),
        phone: sanitizeString(req.body?.phone, 50),
        congregationSize: sanitizeString(req.body?.congregationSize, 20),
        location: sanitizeString(req.body?.location, 200),
        engagementChallenge: sanitizeString(req.body?.engagementChallenge, 2000),
        source: sanitizeString(req.body?.source, 50) || "Landing Page Form",
        role,
      };

      // Minimum required: church name AND (email OR phone)
      if (!body.churchName) {
        return res.status(400).json({ ok: false, error: "Church name is required" });
      }
      if (!body.email && !body.phone) {
        return res.status(400).json({ ok: false, error: "Email or phone is required" });
      }
      if (body.email && !isLikelyEmail(body.email)) {
        return res.status(400).json({ ok: false, error: "Invalid email address" });
      }

      // Honeypot — front-end form has a hidden "website" field; bots fill it.
      if (sanitizeString(req.body?.website, 200)) {
        // Pretend success so bots don't probe further.
        return res.json({ ok: true, message: "Thank you!" });
      }

      const notionResult = await writeToNotion(body as any);
      if (!notionResult.ok) {
        console.error("church-signup: Notion write failed:", notionResult.error);
      }

      const emailResult = await sendNotificationEmail(
        body,
        notionResult.ok ? notionResult.pageId : null,
      );
      if (!emailResult.ok) {
        console.error("church-signup: email send failed:", emailResult.error);
      }

      // Founder welcome reply — best-effort, never blocks the success response.
      const welcomeResult = await sendChurchWelcomeEmail(body);
      if (!welcomeResult.ok && !welcomeResult.skipped) {
        console.error("church-signup: welcome email failed:", welcomeResult.error);
      }

      // If BOTH the internal notify AND Notion write failed, surface a 500 so
      // the user can retry. The founder welcome is purely additive and never
      // gates the response.
      if (!notionResult.ok && !emailResult.ok) {
        return res.status(500).json({
          ok: false,
          error: "We couldn't save your submission. Please email admin@barabove.app directly.",
        });
      }

      res.json({
        ok: true,
        message: "Thank you! We'll be in touch shortly.",
        notionSaved: notionResult.ok,
        emailSent: emailResult.ok,
        welcomeSent: welcomeResult.ok,
      });
    } catch (err: any) {
      console.error("church-signup handler error:", err);
      res.status(500).json({ ok: false, error: "Server error. Please try again." });
    }
  });
}
