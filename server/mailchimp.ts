/**
 * My Shepherd — Mailchimp Service Layer
 *
 * Wraps the Mailchimp Marketing API v3 for:
 *  - Connection testing
 *  - Audience (list) management
 *  - Member sync (add / update / tag)
 *  - Campaign creation, scheduling, and sending
 *  - Automation / sequence enrollment
 *
 * All functions are async and throw descriptive errors on failure.
 * The caller (routes.ts) is responsible for catching and returning HTTP responses.
 */

import mailchimp from "@mailchimp/mailchimp_marketing";
import crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MailchimpConfig {
  apiKey: string;       // e.g. "abc123-us1"
  audienceId: string;   // List ID
}

export interface SyncMemberPayload {
  email: string;
  firstName: string;
  lastName: string;
  segment: string;      // maps to Mailchimp tags
  phone?: string;
}

export interface CampaignPayload {
  audienceId: string;
  subject: string;
  previewText: string;
  fromName: string;     // Church name
  replyTo: string;
  htmlBody: string;
  scheduledAt?: string; // ISO string — if provided, schedules rather than sends
}

// ─── Segment → Mailchimp tag mapping ─────────────────────────────────────────

const SEGMENT_TAGS: Record<string, string> = {
  new_visitor: "New Visitor",
  regular:     "Regular Attender",
  volunteer:   "Volunteer",
  inactive:    "Inactive",
  donor:       "Donor",
};

// ─── MD5 helper (Mailchimp subscriber hash) ──────────────────────────────────

function subscriberHash(email: string): string {
  return crypto.createHash("md5").update(email.toLowerCase().trim()).digest("hex");
}

// ─── Configure client ────────────────────────────────────────────────────────

function getClient(apiKey: string) {
  // Extract server prefix from API key (e.g. "abc123-us1" → "us1")
  const serverPrefix = apiKey.split("-").pop();
  if (!serverPrefix) throw new Error("Invalid Mailchimp API key format. Expected: <key>-<server>");

  mailchimp.setConfig({ apiKey, server: serverPrefix });
  return mailchimp;
}

// ─── Test connection ─────────────────────────────────────────────────────────

export async function testConnection(config: MailchimpConfig): Promise<{
  success: boolean;
  accountName?: string;
  audienceName?: string;
  memberCount?: number;
  error?: string;
}> {
  try {
    const client = getClient(config.apiKey);

    // Ping the API
    const ping = await client.ping.get() as any;
    if (ping.health_status !== "Everything's Chimpy!") {
      throw new Error("Mailchimp ping failed");
    }

    // Get account info
    const account = await client.root.getRoot() as any;

    // Get audience info
    const list = await client.lists.getList(config.audienceId) as any;

    return {
      success: true,
      accountName: account.account_name,
      audienceName: list.name,
      memberCount: list.stats?.member_count ?? 0,
    };
  } catch (err: any) {
    const message = err?.response?.body?.detail || err?.message || "Connection failed";
    return { success: false, error: message };
  }
}

// ─── Sync a single member ─────────────────────────────────────────────────────

export async function syncMember(
  config: MailchimpConfig,
  member: SyncMemberPayload
): Promise<{ success: boolean; mailchimpId?: string; error?: string }> {
  try {
    const client = getClient(config.apiKey);
    const hash = subscriberHash(member.email);

    // Upsert subscriber (PUT = add or update)
    const result = await client.lists.setListMember(config.audienceId, hash, {
      email_address: member.email,
      status_if_new: "subscribed",
      merge_fields: {
        FNAME: member.firstName,
        LNAME: member.lastName,
        PHONE: member.phone || "",
      },
    }) as any;

    // Apply segment tag
    if (member.segment && SEGMENT_TAGS[member.segment]) {
      await client.lists.updateListMemberTags(config.audienceId, hash, {
        tags: [{ name: SEGMENT_TAGS[member.segment], status: "active" }],
      });
    }

    return { success: true, mailchimpId: result.id };
  } catch (err: any) {
    const message = err?.response?.body?.detail || err?.message || "Sync failed";
    return { success: false, error: message };
  }
}

// ─── Sync all members in bulk ────────────────────────────────────────────────

export async function syncAllMembers(
  config: MailchimpConfig,
  members: SyncMemberPayload[]
): Promise<{
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let synced = 0;
  let failed = 0;

  // Mailchimp batch upsert (batch-subscribe)
  try {
    const client = getClient(config.apiKey);
    const batchMembers = members.map(m => ({
      email_address: m.email,
      status: "subscribed" as const,
      merge_fields: {
        FNAME: m.firstName,
        LNAME: m.lastName,
        PHONE: m.phone || "",
      },
      tags: SEGMENT_TAGS[m.segment] ? [SEGMENT_TAGS[m.segment]] : [],
    }));

    const result = await client.lists.batchListMembers(config.audienceId, {
      members: batchMembers,
      update_existing: true,
    }) as any;

    synced = result.new_members?.length + result.updated_members?.length || 0;
    failed = result.error_count || 0;

    if (result.errors?.length > 0) {
      errors.push(...result.errors.map((e: any) => `${e.email_address}: ${e.error}`));
    }

    return { success: true, synced, failed, errors };
  } catch (err: any) {
    const message = err?.response?.body?.detail || err?.message || "Batch sync failed";
    return { success: false, synced: 0, failed: members.length, errors: [message] };
  }
}

// ─── Update member segment tag ────────────────────────────────────────────────

export async function updateMemberTag(
  config: MailchimpConfig,
  email: string,
  oldSegment: string,
  newSegment: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getClient(config.apiKey);
    const hash = subscriberHash(email);
    const tags: { name: string; status: "active" | "inactive" }[] = [];

    if (oldSegment && SEGMENT_TAGS[oldSegment]) {
      tags.push({ name: SEGMENT_TAGS[oldSegment], status: "inactive" });
    }
    if (newSegment && SEGMENT_TAGS[newSegment]) {
      tags.push({ name: SEGMENT_TAGS[newSegment], status: "active" });
    }

    if (tags.length > 0) {
      await client.lists.updateListMemberTags(config.audienceId, hash, { tags });
    }

    return { success: true };
  } catch (err: any) {
    const message = err?.response?.body?.detail || err?.message || "Tag update failed";
    return { success: false, error: message };
  }
}

// ─── Unsubscribe / archive a member ──────────────────────────────────────────

export async function archiveMember(
  config: MailchimpConfig,
  email: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getClient(config.apiKey);
    const hash = subscriberHash(email);
    await client.lists.deleteListMember(config.audienceId, hash);
    return { success: true };
  } catch (err: any) {
    // 404 means already not in the list — treat as success
    if (err?.status === 404 || err?.response?.status === 404) {
      return { success: true };
    }
    const message = err?.response?.body?.detail || err?.message || "Archive failed";
    return { success: false, error: message };
  }
}

// ─── Create a campaign ────────────────────────────────────────────────────────

export async function createCampaign(
  config: MailchimpConfig,
  payload: CampaignPayload
): Promise<{
  success: boolean;
  campaignId?: string;
  webId?: number;
  archiveUrl?: string;
  error?: string;
}> {
  try {
    const client = getClient(config.apiKey);

    // 1. Create the campaign
    const campaign = await client.campaigns.create({
      type: "regular",
      recipients: { list_id: config.audienceId },
      settings: {
        subject_line: payload.subject,
        preview_text: payload.previewText,
        title: payload.subject,
        from_name: payload.fromName,
        reply_to: payload.replyTo,
      },
    }) as any;

    const campaignId = campaign.id;

    // 2. Set content
    await client.campaigns.setContent(campaignId, {
      html: payload.htmlBody,
    });

    // 3. Schedule or send
    if (payload.scheduledAt) {
      const scheduledTime = new Date(payload.scheduledAt).toISOString();
      await client.campaigns.schedule(campaignId, {
        schedule_time: scheduledTime,
      });
    }
    // Note: actual send is a separate action called by the user —
    // we don't auto-send to avoid accidental deploys in demo mode.

    return {
      success: true,
      campaignId,
      webId: campaign.web_id,
      archiveUrl: campaign.archive_url,
    };
  } catch (err: any) {
    const message = err?.response?.body?.detail || err?.message || "Campaign creation failed";
    return { success: false, error: message };
  }
}

// ─── Send an existing campaign immediately ────────────────────────────────────

export async function sendCampaign(
  config: MailchimpConfig,
  mailchimpCampaignId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getClient(config.apiKey);
    await client.campaigns.send(mailchimpCampaignId);
    return { success: true };
  } catch (err: any) {
    const message = err?.response?.body?.detail || err?.message || "Send failed";
    return { success: false, error: message };
  }
}

// ─── Get campaign report stats ────────────────────────────────────────────────

export async function getCampaignReport(
  config: MailchimpConfig,
  mailchimpCampaignId: string
): Promise<{
  success: boolean;
  opens?: number;
  clicks?: number;
  recipients?: number;
  openRate?: number;
  clickRate?: number;
  error?: string;
}> {
  try {
    const client = getClient(config.apiKey);
    const report = await client.reports.getCampaignReport(mailchimpCampaignId) as any;

    return {
      success: true,
      recipients:   report.emails_sent ?? 0,
      opens:        report.opens?.opens_total ?? 0,
      clicks:       report.clicks?.clicks_total ?? 0,
      openRate:     Math.round((report.opens?.open_rate ?? 0) * 100),
      clickRate:    Math.round((report.clicks?.click_rate ?? 0) * 100),
    };
  } catch (err: any) {
    const message = err?.response?.body?.detail || err?.message || "Report fetch failed";
    return { success: false, error: message };
  }
}

// ─── Build devotional email HTML ──────────────────────────────────────────────

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
      <p><a href="*|UNSUB|*">Unsubscribe</a> &nbsp;·&nbsp; <a href="*|UPDATE_PROFILE|*">Update preferences</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Build welcome / onboarding email HTML ────────────────────────────────────

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
      <h1>Welcome, ${firstName}! 🙏</h1>
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
      <p><a href="*|UNSUB|*">Unsubscribe</a> &nbsp;·&nbsp; <a href="*|UPDATE_PROFILE|*">Update preferences</a></p>
    </div>
  </div>
</body>
</html>`;
}
