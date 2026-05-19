/**
 * Email module — Single Send campaigns (broadcast).
 *
 * Used for admin-triggered broadcasts (announcements, weekly devotionals when
 * scheduled in bulk). For per-recipient transactional sends (onboarding step
 * emails, password resets in future), use sgSendMail in sendgrid-client.ts.
 *
 * Phase A scope: create + schedule, send-now, fetch stats. The list scoping
 * uses the per-church list when present so campaigns don't leak across tenants.
 */

import { sgRequest, extractSendGridError } from "./sendgrid-client";
import { logger } from "./logger";
import { data } from "./data";
import type {
  SendGridConfig,
  CampaignPayload,
  CampaignCreateResult,
  CampaignSendResult,
  CampaignStats,
} from "./types";

/**
 * Create a SendGrid Single Send. If scheduledAt is provided, also schedule it.
 * Caller is responsible for persisting the returned campaignId on their
 * local campaign row (we don't reach into storage for that — callers handle it).
 */
export async function createCampaign(
  config: SendGridConfig,
  churchId: number,
  payload: CampaignPayload,
): Promise<CampaignCreateResult> {
  const log = logger.withContext({ churchId, subject: payload.subject });

  try {
    const church = data.getChurch(churchId);
    const listIds = payload.listIds ?? (church?.sendgridListId ? [church.sendgridListId] : undefined);

    const sendTo: Record<string, unknown> = listIds && listIds.length
      ? { list_ids: listIds }
      : { all: true };

    const campaignBody: Record<string, unknown> = {
      name: payload.subject,
      send_to: sendTo,
      email_config: {
        subject: payload.subject,
        generate_plain_content: true,
        html_content: payload.htmlBody,
        sender_id: church?.sendgridSenderId || null,
        suppression_group_id: null,
      },
    };

    const campaign = await sgRequest<{ id?: string }>(
      config, "POST", "/v3/marketing/singlesends", campaignBody,
    );

    const campaignId = campaign?.id;
    if (!campaignId) {
      log.error("email.campaign.create.no_id");
      throw new Error("SendGrid did not return a campaign ID");
    }

    let sendAt: string | undefined;
    if (payload.scheduledAt) {
      const scheduleTime = new Date(payload.scheduledAt).toISOString();
      await sgRequest(
        config, "PUT", `/v3/marketing/singlesends/${campaignId}/schedule`,
        { send_at: scheduleTime },
      );
      sendAt = scheduleTime;
    }

    log.info("email.campaign.created", { campaignId, sendAt: sendAt || "draft" });
    return { success: true, campaignId, sendAt };
  } catch (err) {
    const msg = extractSendGridError(err);
    log.error("email.campaign.create.error", { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Schedule an existing Single Send to send immediately ("send_at: now").
 */
export async function sendCampaign(
  config: SendGridConfig,
  campaignId: string,
): Promise<CampaignSendResult> {
  try {
    await sgRequest(
      config, "PUT", `/v3/marketing/singlesends/${campaignId}/schedule`,
      { send_at: "now" },
    );
    logger.info("email.campaign.sent", { campaignId });
    return { success: true };
  } catch (err) {
    return { success: false, error: extractSendGridError(err) };
  }
}

/**
 * Pull aggregated stats for a Single Send.
 */
export async function getCampaignStats(
  config: SendGridConfig,
  campaignId: string,
): Promise<CampaignStats> {
  try {
    const stats = await sgRequest<{
      results?: Array<{ stats?: { total?: { requests?: number; opens?: number; clicks?: number } } }>;
    }>(config, "GET", `/v3/marketing/stats/singlesends/${campaignId}`);

    const agg = stats?.results?.[0]?.stats?.total;
    if (!agg) return { success: true, requests: 0, opens: 0, clicks: 0, openRate: 0, clickRate: 0 };

    const requests = agg.requests ?? 0;
    const opens    = agg.opens    ?? 0;
    const clicks   = agg.clicks   ?? 0;
    return {
      success: true,
      requests,
      opens,
      clicks,
      openRate:  requests > 0 ? Math.round((opens  / requests) * 100) : 0,
      clickRate: requests > 0 ? Math.round((clicks / requests) * 100) : 0,
    };
  } catch (err) {
    return { success: false, error: extractSendGridError(err) };
  }
}
