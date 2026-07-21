import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, sql, gte, lt, isNull, or, like } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import {
  churches, members, campaigns, sequences, activities, insights, affiliations, appUsers, chats,
  bibleTopicContent, sequenceEnrollments, emailEvents, donations, memberSignups, trafficSnapshots,
  crisisSafetySignals, curatedQuestions,
  type Church, type InsertChurch,
  type Member, type InsertMember,
  type Campaign, type InsertCampaign,
  type Sequence, type InsertSequence,
  type Activity, type InsertActivity,
  type Insight, type InsertInsight,
  type Affiliation, type InsertAffiliation,
  type AppUser, type InsertAppUser,
  type Chat, type InsertChat,
  type BibleTopicContent, type InsertBibleTopicContent,
  type SequenceEnrollment, type InsertSequenceEnrollment,
  type EmailEvent, type InsertEmailEvent,
  type MemberSignup, type InsertMemberSignup,
  type TrafficSnapshot, type InsertTrafficSnapshot,
  type CrisisSafetySignal, type InsertCrisisSafetySignal,
} from "@shared/schema";

// DB_PATH allows the database file to live on a persistent volume in production.
// In Railway we set DB_PATH=/data/shepherd.db and attach a Volume at /data.
// Locally and in tests, defaults to ./shepherd.db.
const DB_PATH = process.env.DB_PATH || "shepherd.db";

// Ensure the directory exists (important for /data on first boot).
const dbDir = path.dirname(DB_PATH);
if (dbDir && dbDir !== "." && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`[storage] Using SQLite database at: ${DB_PATH}`);
const sqlite = new Database(DB_PATH);
export const db = drizzle(sqlite);
// Export raw handle for cases that need raw SQL (e.g. demoReset wipes sqlite_sequence).
export { sqlite };

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS churches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    denomination TEXT NOT NULL DEFAULT '',
    logo_url TEXT NOT NULL DEFAULT '',
    primary_color TEXT NOT NULL DEFAULT '#7B4A1E',
    sendgrid_api_key TEXT NOT NULL DEFAULT '',
    sendgrid_from_email TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    church_id INTEGER NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    segment TEXT NOT NULL DEFAULT 'new_visitor',
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_engaged TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    church_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    subject TEXT NOT NULL,
    preview_text TEXT NOT NULL DEFAULT '',
    body_html TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    scheduled_at TEXT,
    sent_at TEXT,
    recipients INTEGER NOT NULL DEFAULT 0,
    opens INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    bible_topic_tag TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS sequences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    church_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    trigger_segment TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    step_count INTEGER NOT NULL DEFAULT 0,
    enrolled_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    church_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    meta TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    church_id INTEGER,
    topic TEXT NOT NULL,
    question TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    verse_ref TEXT NOT NULL DEFAULT '',
    verse_text TEXT NOT NULL DEFAULT '',
    reflection TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS affiliations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    church_id INTEGER NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    google_id TEXT DEFAULT '',
    magic_token TEXT DEFAULT '',
    magic_expiry TEXT DEFAULT '',
    church_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    topic TEXT NOT NULL,
    question TEXT NOT NULL DEFAULT '',
    verse_ref TEXT NOT NULL DEFAULT '',
    verse_text TEXT NOT NULL DEFAULT '',
    reflection TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── Email module tables (owned by server/email/) ─────────────────────────
  CREATE TABLE IF NOT EXISTS bible_topic_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    verse_ref TEXT NOT NULL DEFAULT '',
    verse_text TEXT NOT NULL DEFAULT '',
    reflection TEXT NOT NULL DEFAULT '',
    rotation_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sequence_enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    church_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    sequence_type TEXT NOT NULL DEFAULT 'onboarding',
    current_step INTEGER NOT NULL DEFAULT 0,
    last_sent_at TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active'
  );
  CREATE INDEX IF NOT EXISTS idx_seq_enroll_member ON sequence_enrollments (member_id, sequence_type);
  CREATE INDEX IF NOT EXISTS idx_seq_enroll_active ON sequence_enrollments (status, last_sent_at);

  CREATE TABLE IF NOT EXISTS email_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    church_id INTEGER,
    member_id INTEGER,
    sendgrid_contact_id TEXT NOT NULL DEFAULT '',
    sendgrid_message_id TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    event_type TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    campaign_id TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
    raw_payload TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_email_events_email   ON email_events (email);
  CREATE INDEX IF NOT EXISTS idx_email_events_type    ON email_events (event_type, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_email_events_member  ON email_events (member_id);

  -- ─── Donations module ───────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS chat_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    reaction TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_reactions_user ON chat_reactions (user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_chat_reactions_chat ON chat_reactions (chat_id);

  CREATE TABLE IF NOT EXISTS donation_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    trigger TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'shown',
    shown_at TEXT NOT NULL DEFAULT (datetime('now')),
    outcome_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_donation_prompts_user ON donation_prompts (user_id, shown_at);

  CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    email TEXT NOT NULL DEFAULT '',
    stripe_session_id TEXT NOT NULL UNIQUE,
    stripe_payment_intent_id TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    frequency TEXT NOT NULL DEFAULT 'one_time',
    status TEXT NOT NULL DEFAULT 'pending',
    prompt_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_donations_user ON donations (user_id);
  CREATE INDEX IF NOT EXISTS idx_donations_status ON donations (status, created_at);

  -- ─── Member signups (app first-visit "stay connected" lead-gen) ─────────────
  CREATE TABLE IF NOT EXISTS member_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    zip_code TEXT NOT NULL,
    user_id INTEGER,
    home_church_name TEXT,
    source TEXT NOT NULL DEFAULT 'app_first_visit_modal',
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_member_signups_created ON member_signups (created_at);

  -- ─── Traffic snapshots (founder pastes Cloudflare uniques in chat; agent
  -- POSTs each daily value here so the Overview "Marketing Site — Unique
  -- Visitors" tile can show the latest number plus delta vs the prior). ────
  CREATE TABLE IF NOT EXISTS traffic_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    metric TEXT NOT NULL,
    value INTEGER NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_traffic_snapshots_lookup
    ON traffic_snapshots (source, metric, recorded_at DESC);

  -- ─── Crisis safety signals (anonymous crisis-language interception log).
  -- Stores ONLY category + optional user/session id + timestamp. NEVER the
  -- message content. Powers the founder digest's anonymous pattern counts. ──
  CREATE TABLE IF NOT EXISTS crisis_safety_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    session_id TEXT,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_crisis_signals_created_at
    ON crisis_safety_signals (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_crisis_signals_category
    ON crisis_safety_signals (category);

  -- ─── Discover — per-admin curated questions. One row per (admin, question)
  -- an admin has starred in the cross-church Discover feed. question_id is a
  -- loose FK to insights.id. Unique (admin_user_id, question_id) makes the
  -- star/unstar toggle idempotent. ──
  CREATE TABLE IF NOT EXISTS curated_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id TEXT NOT NULL,
    question_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_curated_questions_admin_question
    ON curated_questions (admin_user_id, question_id);

  -- Discover feed read paths: recency range scans + category-balanced sampling
  -- (ROW_NUMBER() OVER PARTITION BY topic ORDER BY created_at DESC).
  CREATE INDEX IF NOT EXISTS idx_insights_created_at
    ON insights (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_insights_topic_created_at
    ON insights (topic, created_at DESC);
`);

// ─── Additive column migrations (email module) ───────────────────────────────
// SQLite ALTER TABLE ADD COLUMN is not idempotent — it errors if the column
// already exists. We swallow that specific error so the boot is safe to repeat.
function addColumnIfMissing(table: string, column: string, ddl: string) {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
  } catch (err: any) {
    if (!/duplicate column name/i.test(err?.message || "")) throw err;
  }
}

addColumnIfMissing("churches", "sendgrid_list_id",         "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("churches", "sendgrid_sender_id",       "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("churches", "sendgrid_provisioned_at",  "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("members",  "sendgrid_contact_id",      "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("members",  "unsubscribed_at",          "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("members",  "bounce_count",             "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("members",  "home_zip",                 "TEXT NOT NULL DEFAULT ''");
// Phase B.5 additions — see shared/schema.ts members table for field docs.
addColumnIfMissing("members",  "engagement_segment",       "TEXT NOT NULL DEFAULT 'new'");
addColumnIfMissing("members",  "deactivated_at",           "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("members",  "deactivation_reason",      "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("members",  "is_donor",                 "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("members",  "donor_since",              "TEXT NOT NULL DEFAULT ''");
// Home church name — nullable free-text B2B lead capture (webapp launch feedback).
// member_signups also declares this in CREATE TABLE above; the ADD COLUMN here
// upgrades dev/prod DBs that already created the table from an earlier build.
addColumnIfMissing("app_users",      "home_church_name",   "TEXT");
addColumnIfMissing("member_signups", "home_church_name",   "TEXT");
// Optional ZIP captured at Sign Up (webapp launch feedback).
addColumnIfMissing("app_users",      "zip_code",           "TEXT");
// Discover feed — internal/test/dev/staff tag. Excludes a user's questions from
// the cross-church Discover feed. Defaults false; never flipped automatically.
addColumnIfMissing("app_users",      "is_test_user",       "INTEGER NOT NULL DEFAULT 0");
// Q&A admin dashboard — capture verse + reflection for ALL traffic (anon +
// signed-in) so the /questions page can show the full response, not just the
// signed-in chats table. See shared/schema.ts insights table.
addColumnIfMissing("insights",       "verse_ref",          "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("insights",       "verse_text",         "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("insights",       "reflection",         "TEXT NOT NULL DEFAULT ''");

// Traffic snapshots — forward-safety in case the table was created by an
// older boot before columns were added. CREATE TABLE above is the source of
// truth on fresh DBs.
addColumnIfMissing("traffic_snapshots", "note",             "TEXT NOT NULL DEFAULT ''");

// Seed demo data. Extracted into a function so the /api/demo/reset endpoint
// can call it after wiping. Called at boot only when ALLOW_DEMO_SEED=true AND
// the DB is empty. Production never sets ALLOW_DEMO_SEED, so production stays
// clean. Idempotent guard: bails out if any churches already exist.
export function runDemoSeed(): { inserted: { churches: number; members: number; campaigns: number; sequences: number; activities: number; insights: number } } {
  const existing = db.select().from(churches).all();
  if (existing.length > 0) {
    console.log("[demoSeed] Skipping — churches already exist.");
    return { inserted: { churches: 0, members: 0, campaigns: 0, sequences: 0, activities: 0, insights: 0 } };
  }
  console.log("[demoSeed] Running seed: Grace Community Church + 20 members + 6 campaigns + 3 sequences + activities + insights.");
  // Insert demo church
  const church = db.insert(churches).values({
    name: "Grace Community Church",
    location: "Austin, TX",
    denomination: "Non-denominational",
    logoUrl: "",
    primaryColor: "#7B4A1E",
    sendgridApiKey: "",
    sendgridFromEmail: "",
    status: "active",
  }).returning().get();

  const now = new Date();
  const segments = ["new_visitor", "regular", "volunteer", "inactive", "donor"];
  const firstNames = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Barbara", "David", "Susan", "Richard", "Jessica", "Joseph", "Sarah", "Thomas", "Karen", "Charles", "Lisa"];
  const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Young", "Lewis", "Walker"];

  for (let i = 0; i < 20; i++) {
    const joined = new Date(now.getTime() - Math.random() * 90 * 24 * 60 * 60 * 1000);
    const lastEngaged = new Date(joined.getTime() + Math.random() * 30 * 24 * 60 * 60 * 1000);
    db.insert(members).values({
      churchId: church.id,
      firstName: firstNames[i],
      lastName: lastNames[i],
      email: `${firstNames[i].toLowerCase()}.${lastNames[i].toLowerCase()}@example.com`,
      phone: `512-555-${String(1000 + i).padStart(4, "0")}`,
      segment: segments[i % segments.length],
      joinedAt: joined.toISOString(),
      lastEngaged: lastEngaged.toISOString(),
      notes: "",
    }).run();
  }

  // Campaigns
  const campaignData = [
    { name: "Welcome to Our Family", type: "onboarding", subject: "Welcome to Grace Community Church!", status: "sent", recipients: 12, opens: 9, clicks: 6, bibleTopicTag: "Faith", scheduledAt: null, sentAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() },
    { name: "Monday Scripture: Faith", type: "devotional", subject: "Your Word for the Week — Faith", status: "sent", recipients: 18, opens: 14, clicks: 8, bibleTopicTag: "Faith", scheduledAt: null, sentAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString() },
    { name: "Wednesday Devotional: Hope", type: "devotional", subject: "Mid-Week Reflection — Finding Hope", status: "sent", recipients: 18, opens: 11, clicks: 5, bibleTopicTag: "Hope", scheduledAt: null, sentAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString() },
    { name: "Sunday Prep: Easter Service", type: "event", subject: "Join Us This Sunday — Easter Celebration", status: "scheduled", recipients: 20, opens: 0, clicks: 0, bibleTopicTag: "Salvation", scheduledAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(), sentAt: null },
    { name: "Friday Announcement", type: "announcement", subject: "This Week at Grace — Community News", status: "draft", recipients: 0, opens: 0, clicks: 0, bibleTopicTag: "", scheduledAt: null, sentAt: null },
    { name: "Re-engagement: We Miss You", type: "onboarding", subject: "We've been thinking about you...", status: "scheduled", recipients: 4, opens: 0, clicks: 0, bibleTopicTag: "Peace", scheduledAt: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString(), sentAt: null },
  ];

  for (const c of campaignData) {
    db.insert(campaigns).values({ churchId: church.id, previewText: "", bodyHtml: "", ...c }).run();
  }

  // Sequences
  const seqData = [
    { name: "New Member Onboarding", triggerSegment: "new_visitor", status: "active", stepCount: 5, enrolledCount: 8, completedCount: 3 },
    { name: "Re-engagement Flow", triggerSegment: "inactive", status: "active", stepCount: 3, enrolledCount: 4, completedCount: 1 },
    { name: "Donor Stewardship", triggerSegment: "donor", status: "active", stepCount: 4, enrolledCount: 5, completedCount: 2 },
  ];
  for (const s of seqData) {
    db.insert(sequences).values({ churchId: church.id, ...s }).run();
  }

  // Activities
  const activityData = [
    { type: "member_joined", description: "Lisa Walker joined as a new visitor", createdAt: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString() },
    { type: "email_sent", description: "Wednesday Devotional sent to 18 members", createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString() },
    { type: "member_joined", description: "Charles Lewis joined as a new visitor", createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString() },
    { type: "email_sent", description: "Monday Scripture: Faith sent to 18 members", createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString() },
    { type: "campaign_scheduled", description: "Easter Service email scheduled for Sunday", createdAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString() },
    { type: "email_sent", description: "Welcome to Our Family sent to 12 new members", createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() },
  ];
  for (const a of activityData) {
    db.insert(activities).values({ churchId: church.id, meta: "{}", ...a }).run();
  }

  // Seed demo insight events (~50 topic taps spread over last 30 days)
  const topicSeeds: { topic: string; count: number }[] = [
    { topic: "Anxiety",     count: 18 },
    { topic: "Forgiveness", count: 14 },
    { topic: "Faith",       count: 12 },
    { topic: "Hope",        count: 10 },
    { topic: "Peace",       count: 8  },
    { topic: "Prayer",      count: 7  },
    { topic: "Love",        count: 6  },
    { topic: "Suffering",   count: 4  },
    { topic: "Temptation",  count: 4  },
    { topic: "Salvation",   count: 3  },
    { topic: "Anger",       count: 3  },
    { topic: "Wisdom",      count: 3  },
  ];
  const locations = ["Austin, TX", "Houston, TX", "Dallas, TX", "San Antonio, TX", ""];
  const sessions = ["s1","s2","s3","s4","s5","s6","s7","s8","s9","s10"];
  let seedIdx = 0;
  let insightCount = 0;
  for (const { topic, count } of topicSeeds) {
    for (let i = 0; i < count; i++) {
      const daysAgo = Math.floor(Math.random() * 30);
      const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
      db.insert(insights).values({
        churchId: church.id,
        topic,
        question: "",
        sessionId: sessions[seedIdx % sessions.length],
        location: locations[seedIdx % locations.length],
        createdAt,
      }).run();
      seedIdx++;
      insightCount++;
    }
  }

  console.log(`[demoSeed] Complete: 1 church, 20 members, ${campaignData.length} campaigns, ${seqData.length} sequences, ${activityData.length} activities, ${insightCount} insights.`);
  return {
    inserted: {
      churches: 1,
      members: 20,
      campaigns: campaignData.length,
      sequences: seqData.length,
      activities: activityData.length,
      insights: insightCount,
    },
  };
}

// Run the seed at boot if ALLOW_DEMO_SEED=true. Production never sets this.
if (process.env.ALLOW_DEMO_SEED === "true") {
  runDemoSeed();
}

// Options for the Q&A admin dashboard query. Designed so future Church Admin
// access can scope to a single church_id without changing the call shape.
export type QAAudience = "all" | "signed_in" | "anon";
export interface QAQueryOpts {
  churchId?: number;       // null/undefined = platform-wide (Admin only)
  days?: number;           // 0 or undefined = all-time
  topic?: string;          // category filter (insights.topic)
  audience?: QAAudience;
  search?: string;         // ILIKE across question, topic, verse_ref
  questionsOnly?: boolean; // skip topic-tap-only rows
  limit?: number;
  offset?: number;
}

// ─── Discover feed types ─────────────────────────────────────────────────────
export type DiscoverRange = "7d" | "30d" | "90d";
export type DiscoverSort = "recent" | "similar" | "longest";

export interface DiscoverQueryOpts {
  range?: DiscoverRange;   // default 30d
  category?: string;       // insights.topic filter
  search?: string;         // LIKE across question/topic/verse_ref
  sort?: DiscoverSort;     // default recent
  page?: number;           // 1-based; only used on filtered views
  curatedOnly?: boolean;   // restrict to the current admin's starred rows
  adminUserId: string;     // whose curation state to resolve
}

// A single anonymized Discover row. Deliberately omits session_id, church_id,
// and location — nothing that could identify the asker leaves the server.
export interface DiscoverQuestionRow {
  id: number;
  when: string;      // ISO createdAt
  category: string;  // topic
  question: string;
  verseRef: string;
  verseText: string;
  reflection: string;
  who: "anon";
  curated: boolean;
}

export interface DiscoverResult {
  questions: DiscoverQuestionRow[];
  pagination: { page: number; total_pages: number; total_count: number };
  category_mix: Record<string, number>;
  stats: { total: number; unique_users: number; categories_covered: number; curated_count: number };
}

// Per-category sample size and hard page cap for the default balanced view.
export const DISCOVER_PER_CATEGORY = 10;
export const DISCOVER_MAX_DEFAULT = 100;
export const DISCOVER_PAGE_SIZE = 25;

export interface IStorage {
  // Churches
  getChurches(): Church[];
  getChurch(id: number): Church | undefined;
  createChurch(data: InsertChurch): Church;
  updateChurch(id: number, data: Partial<InsertChurch>): Church | undefined;
  searchChurches(query: string): Church[];
  getChurchesByLocation(lat: number, lng: number, radiusMiles?: number): Church[];

  // Members
  getMembers(churchId: number): Member[];
  getMember(id: number): Member | undefined;
  createMember(data: InsertMember): Member;
  updateMember(id: number, data: Partial<InsertMember>): Member | undefined;
  deleteMember(id: number): void;

  // Campaigns
  getCampaigns(churchId: number): Campaign[];
  getCampaign(id: number): Campaign | undefined;
  createCampaign(data: InsertCampaign): Campaign;
  updateCampaign(id: number, data: Partial<InsertCampaign>): Campaign | undefined;
  deleteCampaign(id: number): void;

  // Sequences
  getSequences(churchId: number): Sequence[];
  getSequence(id: number): Sequence | undefined;
  createSequence(data: InsertSequence): Sequence;
  updateSequence(id: number, data: Partial<InsertSequence>): Sequence | undefined;

  // Activities
  getActivities(churchId: number, limit?: number): Activity[];
  createActivity(data: InsertActivity): Activity;

  // Insights
  logInsight(data: InsertInsight): Insight;
  getInsights(churchId?: number, limit?: number): Insight[];
  getTopTopics(churchId?: number, days?: number): { topic: string; count: number }[];
  getTrendingQuestions(churchId?: number, limit?: number): Insight[];
  // Q&A admin dashboard — paged, filtered, searchable list + summary counts.
  getQA(opts: QAQueryOpts): { rows: Insight[]; total: number; questionTotal: number; signedInTotal: number; anonTotal: number };

  // Discover — cross-church anonymized questions feed + per-admin curation.
  getDiscoverQuestions(opts: DiscoverQueryOpts): DiscoverResult;
  getCuratedQuestionIds(adminUserId: string): number[];
  addCuration(adminUserId: string, questionId: number): void;
  removeCuration(adminUserId: string, questionId: number): void;

  // Affiliations
  createAffiliation(data: InsertAffiliation): Affiliation;
  getAffiliation(sessionId: string): Affiliation | undefined;

  // App Users
  getUserByEmail(email: string): AppUser | undefined;
  getUserById(id: number): AppUser | undefined;
  getUserByGoogleId(googleId: string): AppUser | undefined;
  createUser(data: InsertAppUser): AppUser;
  updateUser(id: number, data: Partial<InsertAppUser>): AppUser | undefined;
  updateUserHomeChurchName(userId: number, homeChurchName: string | null): AppUser | undefined;
  setMagicToken(email: string, token: string, expiry: string, profile?: { homeChurchName?: string | null; zipCode?: string | null }): AppUser;
  verifyMagicToken(token: string): AppUser | undefined;

  // Chats
  saveChat(data: InsertChat): Chat;
  getUserChats(userId: number, limit?: number): Chat[];
  searchUserChats(userId: number, query: string): Chat[];

  // ─── Email module ───────────────────────────────────────────────────────────
  // These methods are the ONLY surface the server/email/ module is allowed to
  // call on storage. See server/email/data.ts (the email module's repository
  // layer) — it wraps these. Do not call email tables directly from outside
  // server/email/.

  // Bible topic content (rotation library)
  getBibleTopicContent(activeOnly?: boolean): BibleTopicContent[];
  getNextRotationTopic(): BibleTopicContent | undefined;
  upsertBibleTopicContent(data: InsertBibleTopicContent): BibleTopicContent;
  bumpRotationOrder(id: number): void;

  // Sequence enrollments
  getEnrollment(memberId: number, sequenceType: string): SequenceEnrollment | undefined;
  createEnrollment(data: InsertSequenceEnrollment): SequenceEnrollment;
  updateEnrollment(id: number, data: Partial<InsertSequenceEnrollment>): SequenceEnrollment | undefined;
  listActiveEnrollmentsDue(sequenceType: string, sinceIso: string): SequenceEnrollment[];

  // Email events (webhook log)
  recordEmailEvent(data: InsertEmailEvent): EmailEvent;
  getMemberByEmail(email: string): Member | undefined;
  getMemberBySendgridContactId(contactId: string): Member | undefined;

  // ─── Phase B additions ─────────────────────────────────────────────────
  /** All members across all churches (used by daily segmentation cron). */
  getAllMembers(): Member[];
  /** Atomically increment bounce_count by 1 and return the new value. */
  incrementBounceCount(memberId: number): number;
  /** Count of completed donations for a given email (used to compute is_donor). */
  getCompletedDonationCountByEmail(email: string): number;
  /** Most recent open/click occurredAt for a member (used by segmentation). Returns ISO string or undefined. */
  getLastEngagementForMember(memberId: number): string | undefined;

  // ─── Phase B.5 additions ───────────────────────────
  /**
   * Members with deactivatedAt != "" in descending recency order.
   * Used by the founder dashboard + nightly digest. The `sinceIso` filter is
   * inclusive and applied to deactivatedAt; pass "" to get all.
   */
  listDeactivatedMembers(sinceIso: string): Member[];
  /**
   * Count of deactivations between two ISO timestamps (inclusive, exclusive).
   * Used by the digest "since yesterday" summary.
   */
  countDeactivationsBetween(fromIso: string, toIso: string): number;
  /**
   * Clear deactivatedAt + deactivationReason on a member and reset bounceCount.
   * If clearUnsubscribe is true, also clears unsubscribedAt. The caller is
   * responsible for deciding whether the unsubscribe was honest — we never
   * override a genuine user unsubscribe in the default code path.
   */
  restoreDeactivatedMember(memberId: number, clearUnsubscribe: boolean): Member | undefined;
  /**
   * Recompute is_donor + donor_since across all members from the donations
   * table. Returns counts. Safety-net job.
   */
  recomputeDonorFlags(): { updated: number; total: number };

  // ─── Member signups (app first-visit lead-gen) ─────────────────────────
  /**
   * Upsert on email: if a row exists, update zipCode/userId/updatedAt and
   * return it; otherwise insert. Returns the resulting row plus whether it
   * already existed (so the route can report alreadyExisted).
   */
  createMemberSignup(input: {
    email: string;
    zipCode: string;
    userId?: number | null;
    homeChurchName?: string | null;
    source?: string;
    ipAddress?: string;
    userAgent?: string;
  }): { row: MemberSignup; alreadyExisted: boolean };
  getMemberSignupByEmail(email: string): MemberSignup | undefined;
  countMemberSignups(): number;

  // ─── Traffic snapshots ─────────────────────────────────────────────────
  /** Insert one snapshot row (e.g. Cloudflare 30-day uniques). */
  createTrafficSnapshot(data: InsertTrafficSnapshot): TrafficSnapshot;
  /** Latest snapshot for a (source, metric) pair, or undefined if none. */
  getLatestTrafficSnapshot(source: string, metric: string): TrafficSnapshot | undefined;
  /** Recent history (newest first) for a (source, metric) pair. */
  getTrafficHistory(source: string, metric: string, limit?: number): TrafficSnapshot[];

  // ─── Crisis safety signals ─────────────────────────────────────────────
  /**
   * Append one crisis-language interception. Records ONLY category + optional
   * user/session id + timestamp. The message content is never passed in here.
   */
  logCrisisSignal(data: InsertCrisisSafetySignal): CrisisSafetySignal;
  /**
   * Count crisis signals grouped by category in [fromIso, toIso). Used by the
   * founder digest for the anonymous 24h rollup.
   */
  getCrisisSignalCounts(fromIso: string, toIso: string): { category: string; count: number }[];
}

export const storage: IStorage = {
  getChurches: () => db.select().from(churches).all(),
  getChurch: (id) => db.select().from(churches).where(eq(churches.id, id)).get(),
  createChurch: (data) => db.insert(churches).values(data).returning().get(),
  updateChurch: (id, data) => db.update(churches).set(data).where(eq(churches.id, id)).returning().get(),

  searchChurches: (query) => {
    const q = `%${query.toLowerCase()}%`;
    return db.select().from(churches)
      .where(sql`lower(${churches.name}) LIKE ${q} OR lower(${churches.location}) LIKE ${q}`)
      .all();
  },

  // Location-based: approximate degrees-to-miles (1 deg lat ≈ 69 miles)
  getChurchesByLocation: (lat, lng, radiusMiles = 25) => {
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / (69 * Math.cos(lat * Math.PI / 180));
    // Churches store location as "City, ST" text — return all for now and let caller filter
    // For a real geo query we'd need lat/lng columns; return all active churches as candidates
    return db.select().from(churches).where(eq(churches.status, "active")).all();
  },

  getMembers: (churchId) => db.select().from(members).where(eq(members.churchId, churchId)).all(),
  getMember: (id) => db.select().from(members).where(eq(members.id, id)).get(),
  createMember: (data) => db.insert(members).values(data).returning().get(),
  updateMember: (id, data) => db.update(members).set(data).where(eq(members.id, id)).returning().get(),
  deleteMember: (id) => { db.delete(members).where(eq(members.id, id)).run(); },

  getCampaigns: (churchId) => db.select().from(campaigns).where(eq(campaigns.churchId, churchId)).all(),
  getCampaign: (id) => db.select().from(campaigns).where(eq(campaigns.id, id)).get(),
  createCampaign: (data) => db.insert(campaigns).values(data).returning().get(),
  updateCampaign: (id, data) => db.update(campaigns).set(data).where(eq(campaigns.id, id)).returning().get(),
  deleteCampaign: (id) => { db.delete(campaigns).where(eq(campaigns.id, id)).run(); },

  getSequences: (churchId) => db.select().from(sequences).where(eq(sequences.churchId, churchId)).all(),
  getSequence: (id) => db.select().from(sequences).where(eq(sequences.id, id)).get(),
  createSequence: (data) => db.insert(sequences).values(data).returning().get(),
  updateSequence: (id, data) => db.update(sequences).set(data).where(eq(sequences.id, id)).returning().get(),

  getActivities: (churchId, limit = 20) =>
    db.select().from(activities).where(eq(activities.churchId, churchId)).orderBy(desc(activities.createdAt)).limit(limit).all(),
  createActivity: (data) => db.insert(activities).values(data).returning().get(),

  // Insights
  logInsight: (data) => db.insert(insights).values(data).returning().get(),

  getInsights: (churchId, limit = 100) => {
    if (churchId !== undefined) {
      return db.select().from(insights)
        .where(eq(insights.churchId, churchId))
        .orderBy(desc(insights.createdAt))
        .limit(limit)
        .all();
    }
    return db.select().from(insights).orderBy(desc(insights.createdAt)).limit(limit).all();
  },

  getTopTopics: (churchId, days = 30) => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = churchId !== undefined
      ? db.select().from(insights)
          .where(and(eq(insights.churchId, churchId), gte(insights.createdAt, since)))
          .all()
      : db.select().from(insights).where(gte(insights.createdAt, since)).all();

    const counts: Record<string, number> = {};
    for (const r of rows) {
      counts[r.topic] = (counts[r.topic] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count);
  },

  getQA: (opts) => {
    const conds: any[] = [];
    if (opts.churchId !== undefined) conds.push(eq(insights.churchId, opts.churchId));
    if (opts.days && opts.days > 0) {
      const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000).toISOString();
      conds.push(gte(insights.createdAt, since));
    }
    if (opts.topic) conds.push(eq(insights.topic, opts.topic));
    if (opts.audience === "signed_in") conds.push(sql`${insights.sessionId} LIKE 'user-%'`);
    else if (opts.audience === "anon")  conds.push(sql`(${insights.sessionId} NOT LIKE 'user-%' OR ${insights.sessionId} = '')`);
    if (opts.questionsOnly) conds.push(sql`trim(${insights.question}) <> ''`);
    if (opts.search) {
      const s = `%${opts.search.replace(/[%_]/g, m => "\\" + m)}%`;
      conds.push(or(like(insights.question, s), like(insights.topic, s), like(insights.verseRef, s)));
    }
    const whereExpr = conds.length ? and(...conds) : undefined;

    // Page
    const limit  = Math.min(Math.max(opts.limit  ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const baseSelect = db.select().from(insights);
    const rows = (whereExpr ? baseSelect.where(whereExpr) : baseSelect)
      .orderBy(desc(insights.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    // Totals (unpaged, same filters)
    const totalRow = (whereExpr
      ? db.select({ c: sql<number>`count(*)` }).from(insights).where(whereExpr)
      : db.select({ c: sql<number>`count(*)` }).from(insights)
    ).get();
    const total = Number(totalRow?.c ?? 0);

    // Sub-totals (respect topic/days/church/search filters but not audience/questionsOnly)
    const subConds: any[] = [];
    if (opts.churchId !== undefined) subConds.push(eq(insights.churchId, opts.churchId));
    if (opts.days && opts.days > 0) {
      const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000).toISOString();
      subConds.push(gte(insights.createdAt, since));
    }
    if (opts.topic) subConds.push(eq(insights.topic, opts.topic));
    if (opts.search) {
      const s = `%${opts.search.replace(/[%_]/g, m => "\\" + m)}%`;
      subConds.push(or(like(insights.question, s), like(insights.topic, s), like(insights.verseRef, s)));
    }
    const subWhere = subConds.length ? and(...subConds) : undefined;

    const qBase = db.select({ c: sql<number>`count(*)` }).from(insights);
    const questionTotalRow = (subWhere
      ? qBase.where(and(subWhere, sql`trim(${insights.question}) <> ''`))
      : qBase.where(sql`trim(${insights.question}) <> ''`)
    ).get();
    const sBase = db.select({ c: sql<number>`count(*)` }).from(insights);
    const signedInTotalRow = (subWhere
      ? sBase.where(and(subWhere, sql`${insights.sessionId} LIKE 'user-%'`))
      : sBase.where(sql`${insights.sessionId} LIKE 'user-%'`)
    ).get();
    const aBase = db.select({ c: sql<number>`count(*)` }).from(insights);
    const anonTotalRow = (subWhere
      ? aBase.where(and(subWhere, sql`(${insights.sessionId} NOT LIKE 'user-%' OR ${insights.sessionId} = '')`))
      : aBase.where(sql`(${insights.sessionId} NOT LIKE 'user-%' OR ${insights.sessionId} = '')`)
    ).get();

    return {
      rows,
      total,
      questionTotal:  Number(questionTotalRow?.c  ?? 0),
      signedInTotal:  Number(signedInTotalRow?.c  ?? 0),
      anonTotal:      Number(anonTotalRow?.c      ?? 0),
    };
  },

  // ─── Discover feed ──────────────────────────────────────────────────────
  // Cross-church, fully anonymized questions feed. Aggregates every question
  // asked in My Shepherd (insights table) across all churches AND unaffiliated
  // app users. Test/dev/staff users (app_users.is_test_user = 1) are excluded;
  // everyone else — including Ryan — is included.
  //
  // Default view (no category / search / curated filter): a category-balanced
  // sample of up to DISCOVER_PER_CATEGORY questions per category via a
  // ROW_NUMBER() OVER (PARTITION BY topic ...) window, so no single popular
  // category dominates the table. Any active filter switches to normal
  // recency/relevance pagination at DISCOVER_PAGE_SIZE rows/page.
  getDiscoverQuestions: (opts) => {
    const days = opts.range === "7d" ? 7 : opts.range === "90d" ? 90 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const adminUserId = opts.adminUserId;

    // Base predicate shared by the feed and the aggregate stats. Bind params in
    // the same order they appear. Test users are filtered via a correlated
    // NOT IN against the synthesized "user-<id>" session ids.
    const baseWhere =
      `i.created_at >= ? ` +
      `AND trim(i.question) <> '' ` +
      `AND i.session_id NOT IN (SELECT 'user-' || id FROM app_users WHERE is_test_user = 1)`;
    const baseParams: any[] = [since];

    // Curated set for this admin (used for the `curated` flag + curated_only filter).
    const curatedIds = new Set<number>(
      (sqlite.prepare(`SELECT question_id FROM curated_questions WHERE admin_user_id = ?`).all(adminUserId) as any[])
        .map(r => Number(r.question_id)),
    );

    const hasCategory = !!(opts.category && opts.category.trim());
    const hasSearch = !!(opts.search && opts.search.trim());
    const curatedOnly = !!opts.curatedOnly;
    const filtered = hasCategory || hasSearch || curatedOnly;

    // Build the filtered WHERE (category / search / curated_only) on top of base.
    const filterClauses: string[] = [baseWhere];
    const filterParams: any[] = [...baseParams];
    if (hasCategory) {
      filterClauses.push(`i.topic = ?`);
      filterParams.push(opts.category!.trim());
    }
    if (hasSearch) {
      const s = `%${opts.search!.trim().replace(/[%_\\]/g, m => "\\" + m)}%`;
      filterClauses.push(`(i.question LIKE ? ESCAPE '\\' OR i.topic LIKE ? ESCAPE '\\' OR i.verse_ref LIKE ? ESCAPE '\\')`);
      filterParams.push(s, s, s);
    }
    if (curatedOnly) {
      // No curated rows → guaranteed-empty predicate keeps the query simple.
      if (curatedIds.size === 0) {
        filterClauses.push(`1 = 0`);
      } else {
        const placeholders = Array.from(curatedIds).map(() => "?").join(", ");
        filterClauses.push(`i.id IN (${placeholders})`);
        filterParams.push(...Array.from(curatedIds));
      }
    }
    const filteredWhere = filterClauses.join(" AND ");

    let rawRows: any[];
    let totalCount: number;
    let page = 1;
    let totalPages = 1;

    if (!filtered) {
      // Default: category-balanced sample via window function.
      rawRows = sqlite.prepare(
        `SELECT id, topic, question, verse_ref, verse_text, reflection, created_at FROM (
           SELECT i.*,
             ROW_NUMBER() OVER (PARTITION BY i.topic ORDER BY i.created_at DESC, i.id DESC) AS rn
           FROM insights i
           WHERE ${baseWhere}
         )
         WHERE rn <= ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      ).all(...baseParams, DISCOVER_PER_CATEGORY, DISCOVER_MAX_DEFAULT) as any[];
      totalCount = rawRows.length;
    } else {
      // Filtered: normal pagination with the requested sort.
      page = Math.max(1, opts.page ?? 1);
      const offset = (page - 1) * DISCOVER_PAGE_SIZE;
      const orderBy =
        opts.sort === "similar" ? `cluster_size DESC, created_at DESC, id DESC` :
        opts.sort === "longest" ? `resp_len DESC, created_at DESC, id DESC` :
        `created_at DESC, id DESC`;

      rawRows = sqlite.prepare(
        `SELECT id, topic, question, verse_ref, verse_text, reflection, created_at FROM (
           SELECT i.*,
             COUNT(*) OVER (PARTITION BY lower(trim(i.question))) AS cluster_size,
             length(i.reflection) AS resp_len
           FROM insights i
           WHERE ${filteredWhere}
         )
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
      ).all(...filterParams, DISCOVER_PAGE_SIZE, offset) as any[];

      const countRow = sqlite.prepare(
        `SELECT count(*) AS c FROM insights i WHERE ${filteredWhere}`,
      ).get(...filterParams) as any;
      totalCount = Number(countRow?.c ?? 0);
      totalPages = Math.max(1, Math.ceil(totalCount / DISCOVER_PAGE_SIZE));
    }

    const questions: DiscoverQuestionRow[] = rawRows.map(r => ({
      id: Number(r.id),
      when: String(r.created_at),
      category: String(r.topic),
      question: String(r.question),
      verseRef: String(r.verse_ref ?? ""),
      verseText: String(r.verse_text ?? ""),
      reflection: String(r.reflection ?? ""),
      who: "anon" as const,
      curated: curatedIds.has(Number(r.id)),
    }));

    // Aggregate stats + category mix over the full date range (base filters
    // only — independent of the table's category/search/curated filters).
    const statsRow = sqlite.prepare(
      `SELECT count(*) AS total,
              count(DISTINCT i.session_id) AS unique_users,
              count(DISTINCT i.topic) AS categories_covered
       FROM insights i WHERE ${baseWhere}`,
    ).get(...baseParams) as any;

    const mixRows = sqlite.prepare(
      `SELECT i.topic AS topic, count(*) AS c
       FROM insights i WHERE ${baseWhere}
       GROUP BY i.topic ORDER BY c DESC`,
    ).all(...baseParams) as any[];
    const category_mix: Record<string, number> = {};
    for (const m of mixRows) category_mix[String(m.topic)] = Number(m.c);

    return {
      questions,
      pagination: { page, total_pages: totalPages, total_count: totalCount },
      category_mix,
      stats: {
        total: Number(statsRow?.total ?? 0),
        unique_users: Number(statsRow?.unique_users ?? 0),
        categories_covered: Number(statsRow?.categories_covered ?? 0),
        curated_count: curatedIds.size,
      },
    };
  },

  getCuratedQuestionIds: (adminUserId) =>
    db.select({ questionId: curatedQuestions.questionId })
      .from(curatedQuestions)
      .where(eq(curatedQuestions.adminUserId, adminUserId))
      .all()
      .map(r => r.questionId),

  addCuration: (adminUserId, questionId) => {
    // Idempotent: the unique index on (admin_user_id, question_id) makes a
    // duplicate star a no-op rather than an error.
    sqlite.prepare(
      `INSERT OR IGNORE INTO curated_questions (admin_user_id, question_id, created_at)
       VALUES (?, ?, ?)`,
    ).run(adminUserId, questionId, new Date().toISOString());
  },

  removeCuration: (adminUserId, questionId) => {
    db.delete(curatedQuestions)
      .where(and(eq(curatedQuestions.adminUserId, adminUserId), eq(curatedQuestions.questionId, questionId)))
      .run();
  },

  getTrendingQuestions: (churchId, limit = 10) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    if (churchId !== undefined) {
      return db.select().from(insights)
        .where(and(eq(insights.churchId, churchId), gte(insights.createdAt, since)))
        .orderBy(desc(insights.createdAt))
        .limit(limit)
        .all()
        .filter(r => r.question && r.question.trim() !== "");
    }
    return db.select().from(insights)
      .where(gte(insights.createdAt, since))
      .orderBy(desc(insights.createdAt))
      .limit(limit)
      .all()
      .filter(r => r.question && r.question.trim() !== "");
  },

  // Affiliations
  createAffiliation: (data) => db.insert(affiliations).values(data).returning().get(),
  getAffiliation: (sessionId) => db.select().from(affiliations).where(eq(affiliations.sessionId, sessionId)).get(),

  // App Users
  getUserByEmail: (email) => db.select().from(appUsers).where(eq(appUsers.email, email.toLowerCase())).get(),
  getUserById: (id) => db.select().from(appUsers).where(eq(appUsers.id, id)).get(),
  getUserByGoogleId: (googleId) => db.select().from(appUsers).where(eq(appUsers.googleId, googleId)).get(),
  createUser: (data) => db.insert(appUsers).values({ ...data, email: data.email.toLowerCase() }).returning().get(),
  updateUser: (id, data) => db.update(appUsers).set(data).where(eq(appUsers.id, id)).returning().get(),

  setMagicToken: (email, token, expiry, profile) => {
    const homeChurchName = profile?.homeChurchName || null;
    const zipCode = profile?.zipCode || null;
    const existing = db.select().from(appUsers).where(eq(appUsers.email, email.toLowerCase())).get();
    if (existing) {
      const patch: Partial<InsertAppUser> = { magicToken: token, magicExpiry: expiry };
      // Only set these on an existing user when a non-empty value is provided —
      // never clobber a previously-captured value with null/empty.
      if (homeChurchName) patch.homeChurchName = homeChurchName;
      if (zipCode) patch.zipCode = zipCode;
      return db.update(appUsers).set(patch)
        .where(eq(appUsers.email, email.toLowerCase())).returning().get()!;
    }
    return db.insert(appUsers).values({
      email: email.toLowerCase(), magicToken: token, magicExpiry: expiry,
      homeChurchName, zipCode,
      createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString(),
    }).returning().get();
  },

  updateUserHomeChurchName: (userId, homeChurchName) =>
    db.update(appUsers).set({ homeChurchName }).where(eq(appUsers.id, userId)).returning().get(),

  verifyMagicToken: (token) => {
    const user = db.select().from(appUsers).where(eq(appUsers.magicToken, token)).get();
    if (!user) return undefined;
    if (!user.magicExpiry || new Date() > new Date(user.magicExpiry)) return undefined;
    // Clear token after use and update lastLoginAt
    db.update(appUsers).set({ magicToken: "", magicExpiry: "", lastLoginAt: new Date().toISOString() })
      .where(eq(appUsers.id, user.id)).run();
    return user;
  },

  // Chats
  saveChat: (data) => db.insert(chats).values(data).returning().get(),
  getUserChats: (userId, limit = 50) =>
    db.select().from(chats).where(eq(chats.userId, userId)).orderBy(desc(chats.createdAt)).limit(limit).all(),
  searchUserChats: (userId, query) => {
    const q = `%${query.toLowerCase()}%`;
    return db.select().from(chats)
      .where(and(
        eq(chats.userId, userId),
        sql`(lower(${chats.topic}) LIKE ${q} OR lower(${chats.question}) LIKE ${q} OR lower(${chats.verseText}) LIKE ${q} OR lower(${chats.reflection}) LIKE ${q})`
      ))
      .orderBy(desc(chats.createdAt))
      .limit(30)
      .all();
  },

  // ─── Email module ───────────────────────────────────────────────────────────
  getBibleTopicContent: (activeOnly = true) => {
    if (activeOnly) {
      return db.select().from(bibleTopicContent)
        .where(eq(bibleTopicContent.active, true))
        .orderBy(bibleTopicContent.rotationOrder)
        .all();
    }
    return db.select().from(bibleTopicContent).orderBy(bibleTopicContent.rotationOrder).all();
  },

  getNextRotationTopic: () =>
    db.select().from(bibleTopicContent)
      .where(eq(bibleTopicContent.active, true))
      .orderBy(bibleTopicContent.rotationOrder)
      .limit(1)
      .get(),

  upsertBibleTopicContent: (data) => {
    const existing = db.select().from(bibleTopicContent)
      .where(eq(bibleTopicContent.topic, data.topic))
      .get();
    if (existing) {
      return db.update(bibleTopicContent).set(data).where(eq(bibleTopicContent.id, existing.id)).returning().get()!;
    }
    return db.insert(bibleTopicContent).values(data).returning().get();
  },

  bumpRotationOrder: (id) => {
    // Move this topic to the end of the rotation
    const maxOrder = db.select({ max: sql<number>`COALESCE(MAX(${bibleTopicContent.rotationOrder}), 0)` })
      .from(bibleTopicContent)
      .get()?.max ?? 0;
    db.update(bibleTopicContent)
      .set({ rotationOrder: maxOrder + 1 })
      .where(eq(bibleTopicContent.id, id))
      .run();
  },

  getEnrollment: (memberId, sequenceType) =>
    db.select().from(sequenceEnrollments)
      .where(and(
        eq(sequenceEnrollments.memberId, memberId),
        eq(sequenceEnrollments.sequenceType, sequenceType),
      ))
      .get(),

  createEnrollment: (data) => db.insert(sequenceEnrollments).values(data).returning().get(),

  updateEnrollment: (id, data) =>
    db.update(sequenceEnrollments).set(data).where(eq(sequenceEnrollments.id, id)).returning().get(),

  listActiveEnrollmentsDue: (sequenceType, sinceIso) =>
    db.select().from(sequenceEnrollments)
      .where(and(
        eq(sequenceEnrollments.sequenceType, sequenceType),
        eq(sequenceEnrollments.status, "active"),
        // due if lastSentAt is empty OR lastSentAt < sinceIso (caller passes the
        // cutoff for whatever step interval is next, e.g. 48h ago for step 2)
        or(
          eq(sequenceEnrollments.lastSentAt, ""),
          sql`${sequenceEnrollments.lastSentAt} < ${sinceIso}`,
        ),
      ))
      .all(),

  recordEmailEvent: (data) => db.insert(emailEvents).values(data).returning().get(),

  getMemberByEmail: (email) =>
    db.select().from(members).where(eq(members.email, email.toLowerCase())).get(),

  getMemberBySendgridContactId: (contactId) => {
    if (!contactId) return undefined;
    return db.select().from(members).where(eq(members.sendgridContactId, contactId)).get();
  },

  // ─── Phase B additions ──────────────────────────────────────────────────────────
  getAllMembers: () => db.select().from(members).all(),

  incrementBounceCount: (memberId) => {
    // Read-modify-write inside a single statement keeps this safe under
    // sequential webhook bursts (webhooks are processed serially per Express request).
    const row = db
      .update(members)
      .set({ bounceCount: sql`${members.bounceCount} + 1` })
      .where(eq(members.id, memberId))
      .returning({ bounceCount: members.bounceCount })
      .get();
    return row?.bounceCount ?? 0;
  },

  getCompletedDonationCountByEmail: (email) => {
    if (!email) return 0;
    const normalized = email.toLowerCase().trim();
    const row = db
      .select({ c: sql<number>`count(*)` })
      .from(donations)
      .where(and(
        eq(donations.email, normalized),
        eq(donations.status, "completed"),
      ))
      .get();
    return Number(row?.c ?? 0);
  },

  // ─── Phase B.5 implementations ────────────────────────────────────────
  listDeactivatedMembers: (sinceIso) => {
    const baseCond = sql`${members.deactivatedAt} != ''`;
    const whereClause = sinceIso
      ? and(baseCond, gte(members.deactivatedAt, sinceIso))
      : baseCond;
    return db
      .select()
      .from(members)
      .where(whereClause)
      .orderBy(desc(members.deactivatedAt))
      .all();
  },

  countDeactivationsBetween: (fromIso, toIso) => {
    const row = db
      .select({ c: sql<number>`count(*)` })
      .from(members)
      .where(
        and(
          sql`${members.deactivatedAt} != ''`,
          gte(members.deactivatedAt, fromIso),
          sql`${members.deactivatedAt} < ${toIso}`,
        ),
      )
      .get();
    return Number(row?.c ?? 0);
  },

  restoreDeactivatedMember: (memberId, clearUnsubscribe) => {
    const patch: Partial<typeof members.$inferInsert> = {
      deactivatedAt: "",
      deactivationReason: "",
      bounceCount: 0,
    };
    if (clearUnsubscribe) {
      patch.unsubscribedAt = "";
    }
    return db
      .update(members)
      .set(patch)
      .where(eq(members.id, memberId))
      .returning()
      .get();
  },

  recomputeDonorFlags: () => {
    const all = db.select().from(members).all();
    let updated = 0;
    for (const m of all) {
      if (!m.email) continue;
      const normalized = m.email.toLowerCase().trim();
      const row = db
        .select({
          c: sql<number>`count(*)`,
          first: sql<string>`min(${donations.completedAt})`,
        })
        .from(donations)
        .where(and(
          eq(donations.email, normalized),
          eq(donations.status, "completed"),
        ))
        .get();
      const count = Number(row?.c ?? 0);
      const wantIsDonor = count > 0 ? 1 : 0;
      const wantSince = count > 0 ? String(row?.first ?? "") : "";
      if (m.isDonor !== wantIsDonor || (wantIsDonor === 1 && !m.donorSince)) {
        db.update(members)
          .set({
            isDonor: wantIsDonor,
            // Never overwrite an existing donor_since.
            donorSince: m.donorSince || wantSince,
          })
          .where(eq(members.id, m.id))
          .run();
        updated++;
      }
    }
    return { updated, total: all.length };
  },

  getLastEngagementForMember: (memberId) => {
    const row = db
      .select({ occurredAt: emailEvents.occurredAt })
      .from(emailEvents)
      .where(and(
        eq(emailEvents.memberId, memberId),
        or(eq(emailEvents.eventType, "open"), eq(emailEvents.eventType, "click")),
      ))
      .orderBy(desc(emailEvents.occurredAt))
      .limit(1)
      .get();
    return row?.occurredAt;
  },

  // ─── Member signups (app first-visit lead-gen) ────────────────────────
  createMemberSignup: (input) => {
    const email = input.email.toLowerCase().trim();
    const existing = db.select().from(memberSignups).where(eq(memberSignups.email, email)).get();
    // Normalize home church: empty/whitespace → null so the "don't overwrite" rule below works.
    const incomingChurch = (input.homeChurchName ?? "").trim() || null;
    if (existing) {
      const row = db.update(memberSignups)
        .set({
          zipCode: input.zipCode,
          // Only set userId if one is provided; never clobber a known userId with null.
          userId: input.userId ?? existing.userId,
          // Only overwrite home church with a non-empty value; preserve earlier capture otherwise.
          homeChurchName: incomingChurch ?? existing.homeChurchName,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(memberSignups.id, existing.id))
        .returning()
        .get()!;
      return { row, alreadyExisted: true };
    }
    const row = db.insert(memberSignups)
      .values({
        email,
        zipCode: input.zipCode,
        userId: input.userId ?? null,
        homeChurchName: incomingChurch,
        source: input.source || "app_first_visit_modal",
        ipAddress: input.ipAddress || "",
        userAgent: input.userAgent || "",
        createdAt: new Date().toISOString(),
        updatedAt: "",
      })
      .returning()
      .get();
    return { row, alreadyExisted: false };
  },

  getMemberSignupByEmail: (email) =>
    db.select().from(memberSignups).where(eq(memberSignups.email, email.toLowerCase().trim())).get(),

  countMemberSignups: () => {
    const row = db.select({ c: sql<number>`count(*)` }).from(memberSignups).get();
    return Number(row?.c ?? 0);
  },

  // ─── Traffic snapshots ──────────────────────────────────────────────────────────
  createTrafficSnapshot: (data) =>
    db.insert(trafficSnapshots).values(data).returning().get(),

  getLatestTrafficSnapshot: (source, metric) =>
    db.select().from(trafficSnapshots)
      .where(and(eq(trafficSnapshots.source, source), eq(trafficSnapshots.metric, metric)))
      .orderBy(desc(trafficSnapshots.recordedAt))
      .limit(1)
      .get(),

  getTrafficHistory: (source, metric, limit = 30) =>
    db.select().from(trafficSnapshots)
      .where(and(eq(trafficSnapshots.source, source), eq(trafficSnapshots.metric, metric)))
      .orderBy(desc(trafficSnapshots.recordedAt))
      .limit(limit)
      .all(),

  // ─── Crisis safety signals ─────────────────────────────────────────────
  logCrisisSignal: (data) =>
    db.insert(crisisSafetySignals).values(data).returning().get(),

  getCrisisSignalCounts: (fromIso, toIso) =>
    db.select({
        category: crisisSafetySignals.category,
        count: sql<number>`count(*)`,
      })
      .from(crisisSafetySignals)
      .where(and(
        gte(crisisSafetySignals.createdAt, fromIso),
        lt(crisisSafetySignals.createdAt, toIso),
      ))
      .groupBy(crisisSafetySignals.category)
      .all(),
};
