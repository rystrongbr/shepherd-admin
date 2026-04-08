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
