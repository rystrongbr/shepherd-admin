import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Churches
export const churches = sqliteTable("churches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  location: text("location").notNull().default(""),
  denomination: text("denomination").notNull().default(""),
  logoUrl: text("logo_url").notNull().default(""),
  primaryColor: text("primary_color").notNull().default("#7B4A1E"),
  sendgridApiKey: text("sendgrid_api_key").notNull().default(""),
  sendgridFromEmail: text("sendgrid_from_email").notNull().default(""),
  // Email module — populated by the provisioning flow when a church is onboarded.
  // sendgridListId        = the church-specific SendGrid Marketing Contacts list ID
  // sendgridSenderId      = the verified single-sender ID resolved from fromEmail
  // sendgridProvisionedAt = last successful provisioning timestamp (ISO)
  sendgridListId: text("sendgrid_list_id").notNull().default(""),
  sendgridSenderId: text("sendgrid_sender_id").notNull().default(""),
  sendgridProvisionedAt: text("sendgrid_provisioned_at").notNull().default(""),
  status: text("status").notNull().default("active"), // active | inactive
});

export const insertChurchSchema = createInsertSchema(churches).omit({ id: true });
export type InsertChurch = z.infer<typeof insertChurchSchema>;
export type Church = typeof churches.$inferSelect;

// Members
export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  churchId: integer("church_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  segment: text("segment").notNull().default("new_visitor"), // new_visitor | regular | volunteer | inactive | donor
  joinedAt: text("joined_at").notNull().default(new Date().toISOString()),
  lastEngaged: text("last_engaged").notNull().default(new Date().toISOString()),
  notes: text("notes").notNull().default(""),
  // Optional. Powers the Find-Your-Church lead-gen flow for members who
  // sign up without an existing church affiliation. Synced to SendGrid as
  // the home_zip custom field.
  homeZip: text("home_zip").notNull().default(""),
  // Email module — populated by syncMember. Allows cheap webhook lookups (event
  // payloads include the SendGrid contact id but not the church id).
  sendgridContactId: text("sendgrid_contact_id").notNull().default(""),
  unsubscribedAt: text("unsubscribed_at").notNull().default(""),
  bounceCount: integer("bounce_count").notNull().default(0),
});

export const insertMemberSchema = createInsertSchema(members).omit({ id: true });
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof members.$inferSelect;

// Email Campaigns
export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  churchId: integer("church_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // onboarding | devotional | event | announcement
  subject: text("subject").notNull(),
  previewText: text("preview_text").notNull().default(""),
  bodyHtml: text("body_html").notNull().default(""),
  status: text("status").notNull().default("draft"), // draft | scheduled | sent | paused
  scheduledAt: text("scheduled_at"),
  sentAt: text("sent_at"),
  recipients: integer("recipients").notNull().default(0),
  opens: integer("opens").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  bibleTopicTag: text("bible_topic_tag").notNull().default(""), // links to My Shepherd topics
});

export const insertCampaignSchema = createInsertSchema(campaigns).omit({ id: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaigns.$inferSelect;

// Email Sequences (automated drip)
export const sequences = sqliteTable("sequences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  churchId: integer("church_id").notNull(),
  name: text("name").notNull(),
  triggerSegment: text("trigger_segment").notNull(), // new_visitor | inactive | donor
  status: text("status").notNull().default("active"), // active | paused
  stepCount: integer("step_count").notNull().default(0),
  enrolledCount: integer("enrolled_count").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0),
});

export const insertSequenceSchema = createInsertSchema(sequences).omit({ id: true });
export type InsertSequence = z.infer<typeof insertSequenceSchema>;
export type Sequence = typeof sequences.$inferSelect;

// Activity feed
export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  churchId: integer("church_id").notNull(),
  type: text("type").notNull(), // member_joined | email_sent | campaign_scheduled | sequence_completed
  description: text("description").notNull(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  meta: text("meta").notNull().default("{}"), // JSON string
});

export const insertActivitySchema = createInsertSchema(activities).omit({ id: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activities.$inferSelect;

// Topic Insights — logs every topic tap / question from the My Shepherd app
export const insights = sqliteTable("insights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  churchId: integer("church_id"),          // null = unaffiliated
  topic: text("topic").notNull(),           // e.g. "Anxiety"
  question: text("question").notNull().default(""), // free-form question text, if any
  sessionId: text("session_id").notNull().default(""), // anonymous browser session
  location: text("location").notNull().default(""),    // city/state from browser geolocation
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertInsightSchema = createInsertSchema(insights).omit({ id: true });
export type InsertInsight = z.infer<typeof insertInsightSchema>;
export type Insight = typeof insights.$inferSelect;

// Church Affiliations — links an anonymous app session to a church
export const affiliations = sqliteTable("affiliations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  churchId: integer("church_id").notNull(),
  firstName: text("first_name").notNull().default(""),
  email: text("email").notNull().default(""),
  location: text("location").notNull().default(""), // lat,lng string
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertAffiliationSchema = createInsertSchema(affiliations).omit({ id: true });
export type InsertAffiliation = z.infer<typeof insertAffiliationSchema>;
export type Affiliation = typeof affiliations.$inferSelect;

// App Users — My Shepherd registered users (magic link + Google)
export const appUsers = sqliteTable("app_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  googleId: text("google_id").default(""),     // set if signed in via Google
  magicToken: text("magic_token").default(""), // current pending magic link token
  magicExpiry: text("magic_expiry").default(""), // ISO expiry of magic token
  churchId: integer("church_id"),              // affiliated church (if any)
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  lastLoginAt: text("last_login_at").notNull().default(new Date().toISOString()),
});

export const insertAppUserSchema = createInsertSchema(appUsers).omit({ id: true });
export type InsertAppUser = z.infer<typeof insertAppUserSchema>;
export type AppUser = typeof appUsers.$inferSelect;

// Chat History — full scripture + reflection saved per user session
export const chats = sqliteTable("chats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  topic: text("topic").notNull(),
  question: text("question").notNull().default(""),
  verseRef: text("verse_ref").notNull().default(""),
  verseText: text("verse_text").notNull().default(""),
  reflection: text("reflection").notNull().default(""),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertChatSchema = createInsertSchema(chats).omit({ id: true });
export type InsertChat = z.infer<typeof insertChatSchema>;
export type Chat = typeof chats.$inferSelect;

// ─── Email module tables ─────────────────────────────────────────────────────
// These tables back the My Shepherd email product (server/email/).
// They live in the shared schema for now but are owned by the email module —
// when the module is extracted to its own service (Option 3), these tables
// move with it. See server/email/README.md "Extraction Playbook".

// Bible Topic Content — rotating library that powers the Mon/Wed/Fri devotional
// cadence. Seeded with the 12 topics the My Shepherd app surfaces.
export const bibleTopicContent = sqliteTable("bible_topic_content", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topic: text("topic").notNull(), // e.g. "Anxiety", "Grief", "Hope"
  verseRef: text("verse_ref").notNull().default(""),
  verseText: text("verse_text").notNull().default(""),
  reflection: text("reflection").notNull().default(""),
  rotationOrder: integer("rotation_order").notNull().default(0), // round-robin position
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertBibleTopicContentSchema = createInsertSchema(bibleTopicContent).omit({ id: true });
export type InsertBibleTopicContent = z.infer<typeof insertBibleTopicContentSchema>;
export type BibleTopicContent = typeof bibleTopicContent.$inferSelect;

// Sequence Enrollments — one row per (member, sequenceType) tracking which
// onboarding steps have been sent. Cron uses this to send the next step
// idempotently. status=active until completedAt is set.
export const sequenceEnrollments = sqliteTable("sequence_enrollments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  churchId: integer("church_id").notNull(),
  memberId: integer("member_id").notNull(),
  sequenceType: text("sequence_type").notNull().default("onboarding"), // onboarding | reengagement
  currentStep: integer("current_step").notNull().default(0), // 0 = welcome sent (day 1), 4 = final step (day 21)
  lastSentAt: text("last_sent_at").notNull().default(""),
  startedAt: text("started_at").notNull().default(new Date().toISOString()),
  completedAt: text("completed_at").notNull().default(""),
  status: text("status").notNull().default("active"), // active | completed | paused | cancelled
});

export const insertSequenceEnrollmentSchema = createInsertSchema(sequenceEnrollments).omit({ id: true });
export type InsertSequenceEnrollment = z.infer<typeof insertSequenceEnrollmentSchema>;
export type SequenceEnrollment = typeof sequenceEnrollments.$inferSelect;

// Email Events — append-only log of every webhook event from SendGrid.
// Lets us debug deliverability complaints and rebuild engagement state if needed.
export const emailEvents = sqliteTable("email_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  churchId: integer("church_id"),
  memberId: integer("member_id"),
  sendgridContactId: text("sendgrid_contact_id").notNull().default(""),
  sendgridMessageId: text("sendgrid_message_id").notNull().default(""),
  email: text("email").notNull(),
  eventType: text("event_type").notNull(), // delivered | open | click | bounce | dropped | unsubscribe | spamreport
  url: text("url").notNull().default(""), // populated for click events
  reason: text("reason").notNull().default(""), // populated for bounce/dropped
  campaignId: text("campaign_id").notNull().default(""), // SendGrid single-send id if known
  occurredAt: text("occurred_at").notNull().default(new Date().toISOString()),
  rawPayload: text("raw_payload").notNull().default("{}"), // JSON string of the original event
});

export const insertEmailEventSchema = createInsertSchema(emailEvents).omit({ id: true });
export type InsertEmailEvent = z.infer<typeof insertEmailEventSchema>;
export type EmailEvent = typeof emailEvents.$inferSelect;
