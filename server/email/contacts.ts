/**
 * Email module — contacts (SendGrid Marketing Contacts).
 *
 * This is where the spec's "custom fields per member" requirement actually
 * lands. We always provision custom fields before syncing so the IDs are
 * available, then we map MemberPayload → SendGrid contact body.
 *
 * Upserts are idempotent: re-sending the same member just updates fields.
 * SendGrid's PUT /v3/marketing/contacts API is async — it returns a job_id
 * and the contact appears in the account ~seconds later. We do NOT block on
 * job completion; callers persist the job_id and surface it for debugging.
 */

import { sgRequest, extractSendGridError } from "./sendgrid-client";
import { ensureCustomFields } from "./provisioning";
import { logger } from "./logger";
import { data } from "./data";
import type {
  SendGridConfig,
  MemberPayload,
  SyncResult,
  ConnectionTestResult,
} from "./types";

/**
 * Test the SendGrid API key + verified-sender combo. Used by the Settings page
 * before the admin saves credentials.
 */
export async function testConnection(config: SendGridConfig): Promise<ConnectionTestResult> {
  try {
    const account = await sgRequest<{ username?: string }>(config, "GET", "/v3/user/account");
    const profile = await sgRequest<{ first_name?: string; last_name?: string; email?: string }>(
      config, "GET", "/v3/user/profile",
    );

    let contactCount = 0;
    try {
      const stats = await sgRequest<{ contact_count?: number }>(
        config, "GET", "/v3/marketing/contacts/count",
      );
      contactCount = stats?.contact_count ?? 0;
    } catch {
      // non-critical
    }

    return {
      success: true,
      accountName: profile?.first_name
        ? `${profile.first_name} ${profile.last_name || ""}`.trim()
        : account?.username || "SendGrid Account",
      email: profile?.email || "",
      contactCount,
    };
  } catch (err) {
    return { success: false, error: extractSendGridError(err) };
  }
}

interface BuildContactOptions {
  member: MemberPayload;
  churchId: number;
  listId?: string;
}

function buildContactBody({ member, churchId }: BuildContactOptions) {
  const customFields: Record<string, string | number> = {
    church_segment: member.segment,
    church_id:      churchId,
  };
  if (member.signupDate)           customFields.signup_date           = toSendGridDate(member.signupDate);
  if (member.lastEngagementDate)   customFields.last_engagement_date  = toSendGridDate(member.lastEngagementDate);
  if (member.isVolunteer !== undefined) customFields.is_volunteer = member.isVolunteer ? 1 : 0;
  if (member.isDonor     !== undefined) customFields.is_donor     = member.isDonor     ? 1 : 0;

  const contact: Record<string, unknown> = {
    email:      member.email.toLowerCase().trim(),
    first_name: member.firstName,
    last_name:  member.lastName,
    custom_fields: customFields,
  };
  if (member.phone) contact.phone_number = member.phone;

  return contact;
}

function toSendGridDate(iso: string): string {
  // SendGrid date custom fields accept YYYY-MM-DD or full ISO. Use YYYY-MM-DD
  // for cleaner display in their UI.
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

/**
 * Sync a single contact. Resolves & maps custom fields by name → ID, attaches
 * to the church list, and upserts.
 */
export async function syncMember(
  config: SendGridConfig,
  churchId: number,
  member: MemberPayload,
): Promise<SyncResult> {
  const log = logger.withContext({ churchId, email: member.email });

  try {
    // Ensure fields exist (cached after first call)
    const fields = await ensureCustomFields(config);

    const church = data.getChurch(churchId);
    const listId = church?.sendgridListId || undefined;

    const contact = buildContactBody({ member, churchId, listId });
    // Translate field names → IDs (SendGrid's API expects {field_id: value})
    contact.custom_fields = remapFieldNames(contact.custom_fields as Record<string, unknown>, fields.fieldMap);

    const requestBody: Record<string, unknown> = { contacts: [contact] };
    if (listId) requestBody.list_ids = [listId];

    const result = await sgRequest<{ job_id?: string }>(
      config, "PUT", "/v3/marketing/contacts", requestBody,
    );

    log.info("email.contact.sync.ok", { jobId: result?.job_id });
    return { success: true, synced: 1, failed: 0, jobId: result?.job_id, errors: [] };
  } catch (err) {
    const msg = extractSendGridError(err);
    log.error("email.contact.sync.error", { error: msg });
    return { success: false, synced: 0, failed: 1, errors: [msg] };
  }
}

/**
 * Bulk sync. SendGrid accepts up to 30,000 contacts per PUT, but we batch in
 * chunks of 1,000 to keep memory and JSON payload size sane, and to let the
 * retry-on-failure granularity stay small.
 */
export async function syncAllMembers(
  config: SendGridConfig,
  churchId: number,
  members: MemberPayload[],
): Promise<SyncResult> {
  if (members.length === 0) {
    return { success: true, synced: 0, failed: 0, errors: [] };
  }

  const log = logger.withContext({ churchId, totalMembers: members.length });

  let fields;
  try {
    fields = await ensureCustomFields(config);
  } catch (err) {
    const msg = extractSendGridError(err);
    log.error("email.contacts.sync_all.field_setup_failed", { error: msg });
    return { success: false, synced: 0, failed: members.length, errors: [msg] };
  }

  const church = data.getChurch(churchId);
  const listId = church?.sendgridListId || undefined;

  const BATCH = 1000;
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];
  let lastJobId: string | undefined;

  for (let i = 0; i < members.length; i += BATCH) {
    const batch = members.slice(i, i + BATCH);
    const contacts = batch.map((m) => {
      const c = buildContactBody({ member: m, churchId, listId });
      c.custom_fields = remapFieldNames(c.custom_fields as Record<string, unknown>, fields.fieldMap);
      return c;
    });

    const requestBody: Record<string, unknown> = { contacts };
    if (listId) requestBody.list_ids = [listId];

    try {
      const res = await sgRequest<{ job_id?: string }>(
        config, "PUT", "/v3/marketing/contacts", requestBody,
      );
      synced += batch.length;
      lastJobId = res?.job_id ?? lastJobId;
      log.info("email.contacts.sync_all.batch_ok", { batchSize: batch.length, jobId: res?.job_id });
    } catch (err) {
      const msg = extractSendGridError(err);
      failed += batch.length;
      errors.push(msg);
      log.warn("email.contacts.sync_all.batch_failed", { batchSize: batch.length, error: msg });
    }
  }

  return {
    success: failed === 0,
    synced,
    failed,
    jobId: lastJobId,
    errors,
  };
}

/**
 * Remove a contact (used when a member is deleted or hard-unsubscribes).
 * Treats "not found" as success.
 */
export async function removeMember(
  config: SendGridConfig,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const searchResult = await sgRequest<{ result?: Record<string, { contact?: { id?: string } }> }>(
      config, "POST", "/v3/marketing/contacts/search/emails",
      { emails: [email.toLowerCase().trim()] },
    );

    const contactId = searchResult?.result?.[email.toLowerCase().trim()]?.contact?.id;
    if (!contactId) return { success: true };

    await sgRequest(config, "DELETE", `/v3/marketing/contacts?ids=${contactId}`);
    logger.info("email.contact.removed", { email, contactId });
    return { success: true };
  } catch (err: any) {
    const status = err?.response?.statusCode || err?.code;
    if (status === 404) return { success: true };
    return { success: false, error: extractSendGridError(err) };
  }
}

function remapFieldNames(
  customFieldsByName: Record<string, unknown>,
  fieldMap: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(customFieldsByName)) {
    const id = fieldMap[name];
    if (id) out[id] = value;
  }
  return out;
}
