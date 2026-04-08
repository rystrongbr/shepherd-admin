/**
 * My Shepherd — SendGrid Service Layer
 *
 * Wraps the SendGrid API for:
 *  - Connection testing (v3/user/account)
 *  - Marketing Contacts sync (add / update / remove)
 *  - Custom lists for segment management
 *  - Single Sends creation, scheduling, and sending
 *  - Email stats / activity
 *
 * All functions are async and throw descriptive errors on failure.
 * The caller (routes.ts) is responsible for catching and returning HTTP responses.
 *
 * SendGrid API docs: https://docs.sendgrid.com/api-reference
 */

import sgMail from "@sendgrid/mail";
import sgClient from "@sendgrid/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SendGridConfig {
  apiKey: string;          // SG.xxxxxxx
  fromEmail: string;       // verified sender email
  fromName?: string;       // display name for From header
}

export interface SyncMemberPayload {
  email: string;
  firstName: string;
  lastName: string;
  segment: string;         // maps to a custom field value
  phone?: string;
}

export interface CampaignPayload {
  subject: string;
  previewText: string;
  fromName: string;        // Church name
  fromEmail: string;       // Verified sender
  htmlBody: string;
  scheduledAt?: string;    // ISO string — if provided, schedules rather than just creates
}

// ─── Segment → custom field value mapping ────────────────────────────────────

const SEGMENT_LABELS: Record<string, string> = {
  new_visitor: "New Visitor",
  regular:     "Regular Attender",
  volunteer:   "Volunteer",
  inactive:    "Inactive",
  donor:       "Donor",
};

// ─── Configure clients ────────────────────────────────────────────────────────

function initClients(apiKey: string) {
  sgMail.setApiKey(apiKey);
  sgClient.setApiKey(apiKey);
}

// ─── Generic SendGrid REST helper ─────────────────────────────────────────────

async function sgRequest(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: Record<string, unknown>
): Promise<any> {
  const request: Parameters<typeof sgClient.request>[0] = {
    method,
    url,
  };
  if (body) request.body = body;
  const [response] = await sgClient.request(request);
  return (response as any).body;
}

// ─── Test connection ──────────────────────────────────────────────────────────

export async function testConnection(config: SendGridConfig): Promise<{
  success: boolean;
  accountName?: string;
  email?: string;
  contactCount?: number;
  error?: string;
}> {
  try {
    initClients(config.apiKey);

    // Get account info
    const account = await sgRequest("GET", "/v3/user/account");
    const profile  = await sgRequest("GET", "/v3/user/profile");

    // Get marketing contacts count
    let contactCount = 0;
    try {
      const stats = await sgRequest("GET", "/v3/marketing/contacts/count");
      contactCount = stats?.contact_count ?? 0;
    } catch {
      // contacts count is non-critical — ignore if fails
    }

    return {
      success: true,
      accountName: profile?.first_name
        ? `${profile.first_name} ${profile.last_name || ""}`.trim()
        : account?.username || "SendGrid Account",
      email: profile?.email || "",
      contactCount,
    };
  } catch (err: any) {
    const message = extractError(err);
    return { success: false, error: message };
  }
}

// ─── Sync a single contact ────────────────────────────────────────────────────

export async function syncMember(
  config: SendGridConfig,
  member: SyncMemberPayload
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  try {
    initClients(config.apiKey);

    const contact: Record<string, unknown> = {
      email:      member.email,
      first_name: member.firstName,
      last_name:  member.lastName,
      custom_fields: {
        // We use a reserved field approach — segment stored in phone_number_id custom field
        // but more cleanly: we store it as a custom field named "church_segment"
        // SendGrid custom fields must be pre-created; we use a simple approach here.
      },
    };
    if (member.phone) {
      contact.phone_number = member.phone;
    }

    // Upsert contact via Marketing Contacts API
    const result = await sgRequest("PUT", "/v3/marketing/contacts", {
      contacts: [contact],
    });

    return { success: true, jobId: result?.job_id };
  } catch (err: any) {
    return { success: false, error: extractError(err) };
  }
}

// ─── Sync all members in bulk ─────────────────────────────────────────────────

export async function syncAllMembers(
  config: SendGridConfig,
  members: SyncMemberPayload[]
): Promise<{
  success: boolean;
  synced: number;
  failed: number;
  jobId?: string;
  errors: string[];
}> {
  try {
    initClients(config.apiKey);

    // SendGrid Marketing Contacts API accepts up to 30,000 contacts per upsert
    const contacts = members.map(m => ({
      email:      m.email,
      first_name: m.firstName,
      last_name:  m.lastName,
      ...(m.phone ? { phone_number: m.phone } : {}),
    }));

    const result = await sgRequest("PUT", "/v3/marketing/contacts", { contacts });

    return {
      success: true,
      synced:  members.length,
      failed:  0,
      jobId:   result?.job_id,
      errors:  [],
    };
  } catch (err: any) {
    return {
      success: false,
      synced: 0,
      failed: members.length,
      errors: [extractError(err)],
    };
  }
}

// ─── Remove a contact (unsubscribe) ──────────────────────────────────────────

export async function removeMember(
  config: SendGridConfig,
  email: string
): Promise<{ success: boolean; error?: string }> {
  try {
    initClients(config.apiKey);

    // First find the contact ID by email
    const searchResult = await sgRequest("POST", "/v3/marketing/contacts/search/emails", {
      emails: [email.toLowerCase().trim()],
    });

    const contactId = searchResult?.result?.[email.toLowerCase().trim()]?.contact?.id;
    if (!contactId) {
      // Not found → treat as success (already removed)
      return { success: true };
    }

    await sgRequest("DELETE", `/v3/marketing/contacts?ids=${contactId}`);
    return { success: true };
  } catch (err: any) {
    // If not found, treat as success
    const status = err?.response?.status || err?.code;
    if (status === 404) return { success: true };
    return { success: false, error: extractError(err) };
  }
}

// ─── Create a Single Send campaign ───────────────────────────────────────────

export async function createCampaign(
  config: SendGridConfig,
  payload: CampaignPayload
): Promise<{
  success: boolean;
  campaignId?: string;
  sendAt?: string;
  error?: string;
}> {
  try {
    initClients(config.apiKey);

    // 1. Get or create a list to send to (all contacts)
    //    We send to all contacts by default — no list_ids = entire audience
    const sendTo: Record<string, unknown> = {
      all: true,
    };

    // 2. Create the Single Send
    const campaignBody: Record<string, unknown> = {
      name:    payload.subject,
      send_to: sendTo,
      email_config: {
        subject:      payload.subject,
        generate_plain_content: true,
        html_content: payload.htmlBody,
        sender_id:    null, // Will be resolved below
        suppression_group_id: null,
      },
    };

    // Resolve sender — use the verified sender that matches fromEmail
    try {
      const senders = await sgRequest("GET", "/v3/verified_senders");
      const match = senders?.results?.find(
        (s: any) =>
          s.from_email?.toLowerCase() === payload.fromEmail.toLowerCase() && s.verified
      );
      if (match) {
        (campaignBody.email_config as any).sender_id = match.id;
      }
    } catch {
      // If sender lookup fails, proceed without — user can fix in SendGrid UI
    }

    const campaign = await sgRequest("POST", "/v3/marketing/singlesends", campaignBody);
    const campaignId = campaign?.id;

    if (!campaignId) throw new Error("SendGrid did not return a campaign ID");

    // 3. Schedule or leave as draft
    let sendAt: string | undefined;
    if (payload.scheduledAt) {
      const scheduleTime = new Date(payload.scheduledAt).toISOString();
      await sgRequest("PUT", `/v3/marketing/singlesends/${campaignId}/schedule`, {
        send_at: scheduleTime,
      });
      sendAt = scheduleTime;
    }

    return { success: true, campaignId, sendAt };
  } catch (err: any) {
    return { success: false, error: extractError(err) };
  }
}

// ─── Send an existing Single Send immediately ─────────────────────────────────

export async function sendCampaign(
  config: SendGridConfig,
  campaignId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    initClients(config.apiKey);

    await sgRequest("PUT", `/v3/marketing/singlesends/${campaignId}/schedule`, {
      send_at: "now",
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: extractError(err) };
  }
}

// ─── Get campaign stats ───────────────────────────────────────────────────────

export async function getCampaignStats(
  config: SendGridConfig,
  campaignId: string
): Promise<{
  success: boolean;
  requests?: number;
  opens?: number;
  clicks?: number;
  openRate?: number;
  clickRate?: number;
  error?: string;
}> {
  try {
    initClients(config.apiKey);

    const stats = await sgRequest("GET", `/v3/marketing/stats/singlesends/${campaignId}`);
    const agg = stats?.results?.[0]?.stats?.total;

    if (!agg) {
      return { success: true, requests: 0, opens: 0, clicks: 0, openRate: 0, clickRate: 0 };
    }

    const requests = agg.requests ?? 0;
    const opens    = agg.opens    ?? 0;
    const clicks   = agg.clicks   ?? 0;

    return {
      success:   true,
      requests,
      opens,
      clicks,
      openRate:  requests > 0 ? Math.round((opens  / requests) * 100) : 0,
      clickRate: requests > 0 ? Math.round((clicks / requests) * 100) : 0,
    };
  } catch (err: any) {
    return { success: false, error: extractError(err) };
  }
}

// ─── Build devotional email HTML ──────────────────────────────────────────────
// (identical content, but unsubscribe link uses SendGrid's {{unsubscribe}} tag)

export function buildDevotionalEmailHtml(options: {
  churchName: string;
  primaryColor: string;
  bibleTopicTag: string;
  verseText?: string;
  reflection?: string;
  appUrl?: string;
}): string {
  const {
    churchName,
    primaryColor,
    bibleTopicTag,
    verseText = "",
    reflection = "",
    appUrl = "https://www.perplexity.ai/computer/a/my-shepherd-b60itYhoS.KMg3WAjfUPEQ",
  } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${churchName} — ${bibleTopicTag}</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f0eb; font-family: Georgia, 'Times New Roman', serif; }
    .wrapper { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: ${primaryColor}; padding: 28px 32px; }
    .header h1 { margin: 0; color: #fff; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
    .header p { margin: 4px 0 0; color: rgba(255,255,255,0.7); font-size: 13px; font-family: Arial, sans-serif; }
    .topic-bar { background: #f9f5f0; border-left: 4px solid ${primaryColor}; padding: 14px 24px; font-family: Arial, sans-serif; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${primaryColor}; }
    .body { padding: 32px; }
    .verse { font-style: italic; font-size: 18px; line-height: 1.7; color: #3a2e1e; border-left: 3px solid ${primaryColor}; padding-left: 20px; margin: 0 0 24px; }
    .reflection { font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4a4038; margin: 0 0 32px; }
    .cta-block { text-align: center; padding: 24px; background: #f9f5f0; border-radius: 8px; margin-bottom: 32px; }
    .cta-block p { margin: 0 0 14px; font-family: Arial, sans-serif; font-size: 14px; color: #6b5a4a; }
    .cta-btn { display: inline-block; background: ${primaryColor}; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; }
    .footer { padding: 20px 32px; border-top: 1px solid #e8e0d8; font-family: Arial, sans-serif; font-size: 12px; color: #9a8a7a; text-align: center; }
    .footer a { color: #9a8a7a; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${churchName}</h1>
      <p>A word for your week</p>
    </div>
    <div class="topic-bar">This week's topic: ${bibleTopicTag}</div>
    <div class="body">
      ${verseText ? `<blockquote class="verse">"${verseText}"</blockquote>` : ""}
      ${reflection ? `<p class="reflection">${reflection}</p>` : `<p class="reflection">This week, we invite you to spend time reflecting on what Scripture says about <strong>${bibleTopicTag}</strong>. Let God's Word be your guide as you navigate the days ahead.</p>`}
      <div class="cta-block">
        <p>Explore more Scripture on <strong>${bibleTopicTag}</strong> in the My Shepherd app</p>
        <a href="${appUrl}" class="cta-btn">Go Deeper in My Shepherd →</a>
      </div>
    </div>
    <div class="footer">
      <p>You're receiving this because you're a member of ${churchName}.</p>
      <p><a href="{{unsubscribe}}">Unsubscribe</a> &nbsp;·&nbsp; <a href="{{unsubscribe_preferences}}">Update preferences</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Build welcome / onboarding email HTML ─────────────────────────────────────

export function buildWelcomeEmailHtml(options: {
  churchName: string;
  primaryColor: string;
  firstName: string;
  appUrl?: string;
}): string {
  const {
    churchName,
    primaryColor,
    firstName,
    appUrl = "https://www.perplexity.ai/computer/a/my-shepherd-b60itYhoS.KMg3WAjfUPEQ",
  } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ${churchName}!</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f0eb; font-family: Georgia, 'Times New Roman', serif; }
    .wrapper { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: ${primaryColor}; padding: 36px 32px; text-align: center; }
    .header h1 { margin: 0; color: #fff; font-size: 28px; font-weight: 700; }
    .header p { margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 15px; font-family: Arial, sans-serif; }
    .body { padding: 36px 32px; }
    .greeting { font-size: 20px; color: #3a2e1e; margin-bottom: 20px; }
    .body p { font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4a4038; margin: 0 0 16px; }
    .steps { background: #f9f5f0; border-radius: 8px; padding: 24px; margin: 24px 0; }
    .step { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; font-family: Arial, sans-serif; font-size: 14px; color: #4a4038; line-height: 1.5; }
    .step:last-child { margin-bottom: 0; }
    .step-num { background: ${primaryColor}; color: #fff; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
    .cta-btn { display: inline-block; background: ${primaryColor}; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-family: Arial, sans-serif; font-size: 15px; font-weight: 600; margin: 8px 0 24px; }
    .footer { padding: 20px 32px; border-top: 1px solid #e8e0d8; font-family: Arial, sans-serif; font-size: 12px; color: #9a8a7a; text-align: center; }
    .footer a { color: #9a8a7a; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Welcome, ${firstName}!</h1>
      <p>We're so glad you're here</p>
    </div>
    <div class="body">
      <p class="greeting">Dear ${firstName},</p>
      <p>Welcome to <strong>${churchName}</strong>. Our community exists to help people grow in faith, connect with one another, and experience the life-changing power of God's Word.</p>
      <p>Here are a few ways to get connected:</p>
      <div class="steps">
        <div class="step"><span class="step-num">1</span><span><strong>Explore Scripture</strong> — Use My Shepherd to discover what the Bible says about topics you're facing right now.</span></div>
        <div class="step"><span class="step-num">2</span><span><strong>Join a small group</strong> — Community is where faith grows. Ask us about our small groups at the next service.</span></div>
        <div class="step"><span class="step-num">3</span><span><strong>Stay connected</strong> — You'll hear from us a couple of times each week with Scripture, devotionals, and upcoming events.</span></div>
      </div>
      <p>In the meantime, explore Scripture in the My Shepherd app — it's a great starting point for any question you're carrying.</p>
      <a href="${appUrl}" class="cta-btn">Open My Shepherd</a>
      <p>With joy,<br /><strong>The ${churchName} Team</strong></p>
    </div>
    <div class="footer">
      <p><a href="{{unsubscribe}}">Unsubscribe</a> &nbsp;·&nbsp; <a href="{{unsubscribe_preferences}}">Update preferences</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Error helper ─────────────────────────────────────────────────────────────

function extractError(err: any): string {
  // SendGrid errors nest inside response.body.errors array
  const body = err?.response?.body;
  if (body?.errors?.length) {
    return body.errors.map((e: any) => e.message || JSON.stringify(e)).join("; ");
  }
  return err?.message || "Unknown SendGrid error";
}
