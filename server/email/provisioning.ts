/**
 * Email module — SendGrid provisioning.
 *
 * Idempotently sets up the per-church SendGrid state we need before we can
 * sync members or send campaigns:
 *
 *   1. Custom fields on the SendGrid account (account-level, not list-level)
 *      so we can attach segment metadata to each contact.
 *      - church_segment      (text)   maps to members.segment
 *      - signup_date         (date)   maps to members.joinedAt
 *      - last_engagement_date (date)  maps to members.lastEngaged
 *      - is_volunteer        (number) 1/0
 *      - is_donor            (number) 1/0
 *
 *   2. A per-church Marketing Contacts list so we can target campaigns by
 *      church without leaking other tenants' contacts.
 *
 *   3. Sender ID resolution — looks up the verified sender that matches the
 *      church's fromEmail. Stored on the church record so we don't repeat the
 *      lookup on every campaign push.
 *
 * Re-running provision() is safe: existing fields/lists are detected by name
 * and reused. We only write back to the church row when something actually
 * changed.
 */

import { sgRequest, extractSendGridError } from "./sendgrid-client";
import { logger } from "./logger";
import { data } from "./data";
import type { SendGridConfig, ProvisioningResult } from "./types";

// Field name → SendGrid field type. Account custom fields are global per
// SendGrid account; reusing names across churches is fine and intended.
const CUSTOM_FIELDS: Array<{ name: string; type: "Text" | "Number" | "Date" }> = [
  { name: "church_segment",        type: "Text"   },
  { name: "church_id",             type: "Number" }, // tenant tag on every contact
  { name: "signup_date",           type: "Date"   },
  { name: "last_engagement_date",  type: "Date"   },
  { name: "is_volunteer",          type: "Number" },
  { name: "is_donor",              type: "Number" },
];

interface CustomFieldDefinition {
  id: string;
  name: string;
  field_type: string;
}

/**
 * Ensure the account-level custom fields exist. Returns a map of field name
 * → SendGrid field ID. Field IDs are stable per account and reused on every
 * sync, so we cache the result in module memory after the first call.
 */
let cachedFieldMap: Record<string, string> | null = null;

export async function ensureCustomFields(
  config: SendGridConfig,
): Promise<{ fieldMap: Record<string, string>; created: string[]; warnings: string[] }> {
  if (cachedFieldMap) {
    return { fieldMap: cachedFieldMap, created: [], warnings: [] };
  }

  const warnings: string[] = [];
  const created: string[] = [];

  // GET existing definitions
  let existing: CustomFieldDefinition[] = [];
  try {
    const res = await sgRequest<{ custom_fields?: CustomFieldDefinition[] }>(
      config, "GET", "/v3/marketing/field_definitions",
    );
    existing = res?.custom_fields ?? [];
  } catch (err) {
    warnings.push(`Could not list custom fields: ${extractSendGridError(err)}`);
  }

  const byName = new Map(existing.map((f) => [f.name, f]));
  const fieldMap: Record<string, string> = {};

  for (const def of CUSTOM_FIELDS) {
    const found = byName.get(def.name);
    if (found) {
      fieldMap[def.name] = found.id;
      continue;
    }
    try {
      const created$ = await sgRequest<CustomFieldDefinition>(
        config, "POST", "/v3/marketing/field_definitions",
        { name: def.name, field_type: def.type },
      );
      fieldMap[def.name] = created$.id;
      created.push(def.name);
      logger.info("email.custom_field.created", { name: def.name, id: created$.id });
    } catch (err) {
      warnings.push(`Could not create field ${def.name}: ${extractSendGridError(err)}`);
    }
  }

  cachedFieldMap = fieldMap;
  return { fieldMap, created, warnings };
}

/**
 * Find or create a per-church Marketing Contacts list. Returns the list ID.
 */
export async function ensureChurchList(
  config: SendGridConfig,
  churchId: number,
  churchName: string,
): Promise<{ listId: string | undefined; created: boolean; warning?: string }> {
  const listName = `church-${churchId}`; // stable, predictable identifier

  try {
    // SendGrid paginates lists; for now we assume < 1000 lists per account.
    const res = await sgRequest<{ result?: Array<{ id: string; name: string }> }>(
      config, "GET", "/v3/marketing/lists?page_size=1000",
    );
    const found = res?.result?.find((l) => l.name === listName);
    if (found) {
      return { listId: found.id, created: false };
    }

    const created$ = await sgRequest<{ id: string }>(
      config, "POST", "/v3/marketing/lists",
      { name: listName },
    );
    logger.info("email.list.created", { churchId, listId: created$.id, listName, displayName: churchName });
    return { listId: created$.id, created: true };
  } catch (err) {
    return { listId: undefined, created: false, warning: extractSendGridError(err) };
  }
}

/**
 * Resolve the verified-sender ID that matches a church's fromEmail.
 * Returns undefined if the sender is not yet verified — provisioning still
 * succeeds; the church admin is told to verify via the SendGrid dashboard.
 */
export async function resolveSenderId(
  config: SendGridConfig,
): Promise<{ senderId?: string; warning?: string }> {
  try {
    const res = await sgRequest<{ results?: Array<{ id: string; from_email: string; verified: boolean }> }>(
      config, "GET", "/v3/verified_senders",
    );
    const match = res?.results?.find(
      (s) => s.from_email?.toLowerCase() === config.fromEmail.toLowerCase() && s.verified,
    );
    return match ? { senderId: match.id } : { warning: `No verified sender matches ${config.fromEmail}. Verify it in the SendGrid dashboard.` };
  } catch (err) {
    return { warning: extractSendGridError(err) };
  }
}

/**
 * Full provisioning flow for a church. Safe to re-run.
 * Persists listId / senderId / provisionedAt back onto the church row.
 */
export async function provisionChurch(
  churchId: number,
): Promise<ProvisioningResult> {
  const church = data.getChurch(churchId);
  if (!church) {
    return { success: false, customFieldsEnsured: [], warnings: [], error: "Church not found" };
  }
  if (!church.sendgridApiKey || !church.sendgridFromEmail) {
    return {
      success: false,
      customFieldsEnsured: [],
      warnings: [],
      error: "SendGrid not configured for this church (apiKey + fromEmail required).",
    };
  }

  const config: SendGridConfig = {
    apiKey:    church.sendgridApiKey,
    fromEmail: church.sendgridFromEmail,
    fromName:  church.name,
  };

  const log = logger.withContext({ churchId, churchName: church.name });
  log.info("email.provision.start");

  const allWarnings: string[] = [];

  // 1. Custom fields (account-level, shared across churches)
  const fields = await ensureCustomFields(config);
  allWarnings.push(...fields.warnings);

  // 2. Per-church list
  const list = await ensureChurchList(config, churchId, church.name);
  if (list.warning) allWarnings.push(list.warning);

  // 3. Verified sender
  const sender = await resolveSenderId(config);
  if (sender.warning) allWarnings.push(sender.warning);

  // 4. Persist
  const patch: Record<string, string> = {
    sendgridProvisionedAt: new Date().toISOString(),
  };
  if (list.listId && list.listId !== church.sendgridListId) {
    patch.sendgridListId = list.listId;
  }
  if (sender.senderId && sender.senderId !== church.sendgridSenderId) {
    patch.sendgridSenderId = sender.senderId;
  }
  data.updateChurch(churchId, patch);

  log.info("email.provision.done", {
    listId: list.listId,
    senderId: sender.senderId,
    customFieldsCreated: fields.created.length,
    warnings: allWarnings.length,
  });

  return {
    success: true,
    listId: list.listId,
    senderId: sender.senderId,
    customFieldsEnsured: Object.keys(fields.fieldMap),
    warnings: allWarnings,
  };
}

/** Test-only helper to reset the cache between unit tests. */
export function _resetProvisioningCache() {
  cachedFieldMap = null;
}
