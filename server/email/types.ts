/**
 * Email module — public type definitions.
 *
 * These are the contract between server/routes.ts (caller) and the email
 * module. When the module is extracted to its own HTTP service, these
 * become the JSON shapes for /v1/contacts, /v1/campaigns, etc.
 */

export interface SendGridConfig {
  /** SG.xxxxxxx */
  apiKey: string;
  /** Verified sender email (must match a verified sender or authenticated domain). */
  fromEmail: string;
  /** Display name in the From header (typically the church name). */
  fromName?: string;
}

export interface MemberPayload {
  email: string;
  firstName: string;
  lastName: string;
  /** new_visitor | regular | volunteer | inactive | donor */
  segment: string;
  phone?: string;
  /** ISO 8601. If omitted, SendGrid keeps prior value or leaves field empty. */
  signupDate?: string;
  /** ISO 8601. Updated by cron + webhook handlers. */
  lastEngagementDate?: string;
  /** Convenience flags. Stored as bool custom fields in SendGrid. */
  isVolunteer?: boolean;
  isDonor?: boolean;
}

export interface CampaignPayload {
  subject: string;
  previewText: string;
  fromName: string;
  fromEmail: string;
  htmlBody: string;
  /** ISO 8601. If omitted, the Single Send is created as a draft. */
  scheduledAt?: string;
  /** Optional list ID to send to (defaults to all contacts). */
  listIds?: string[];
}

export interface ProvisioningResult {
  success: boolean;
  /** Sendgrid list ID created or found for this church. */
  listId?: string;
  /** Resolved verified-sender ID matching the church's fromEmail. */
  senderId?: string;
  /** Names of custom fields created or confirmed. */
  customFieldsEnsured: string[];
  warnings: string[];
  error?: string;
}

export interface SyncResult {
  success: boolean;
  /** Number of contacts successfully accepted by SendGrid in this batch. */
  synced: number;
  /** Number of contacts that failed (e.g. invalid email). */
  failed: number;
  /** SendGrid asynchronous job ID (PUT /v3/marketing/contacts returns one). */
  jobId?: string;
  /** Local contact IDs keyed by email (when known) — used to persist sendgridContactId. */
  contactIds?: Record<string, string>;
  errors: string[];
}

export interface CampaignCreateResult {
  success: boolean;
  campaignId?: string;
  /** Echoed back if scheduled. */
  sendAt?: string;
  error?: string;
}

export interface CampaignSendResult {
  success: boolean;
  error?: string;
}

export interface CampaignStats {
  success: boolean;
  requests?: number;
  opens?: number;
  clicks?: number;
  openRate?: number;
  clickRate?: number;
  error?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  accountName?: string;
  email?: string;
  contactCount?: number;
  error?: string;
}
