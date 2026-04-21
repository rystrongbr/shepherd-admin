import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, sql, gte, isNull, or } from "drizzle-orm";
import {
  churches, members, campaigns, sequences, activities, insights, affiliations, appUsers, chats,
  type Church, type InsertChurch,
  type Member, type InsertMember,
  type Campaign, type InsertCampaign,
  type Sequence, type InsertSequence,
  type Activity, type InsertActivity,
  type Insight, type InsertInsight,
  type Affiliation, type InsertAffiliation,
  type AppUser, type InsertAppUser,
  type Chat, type InsertChat,
} from "@shared/schema";

const sqlite = new Database("shepherd.db");
export const db = drizzle(sqlite);

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
`);

// Seed demo data if empty
const existingChurches = db.select().from(churches).all();
if (existingChurches.length === 0) {
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
    }
  }
}

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

  // Affiliations
  createAffiliation(data: InsertAffiliation): Affiliation;
  getAffiliation(sessionId: string): Affiliation | undefined;

  // App Users
  getUserByEmail(email: string): AppUser | undefined;
  getUserById(id: number): AppUser | undefined;
  getUserByGoogleId(googleId: string): AppUser | undefined;
  createUser(data: InsertAppUser): AppUser;
  updateUser(id: number, data: Partial<InsertAppUser>): AppUser | undefined;
  setMagicToken(email: string, token: string, expiry: string): AppUser;
  verifyMagicToken(token: string): AppUser | undefined;

  // Chats
  saveChat(data: InsertChat): Chat;
  getUserChats(userId: number, limit?: number): Chat[];
  searchUserChats(userId: number, query: string): Chat[];
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

  setMagicToken: (email, token, expiry) => {
    const existing = db.select().from(appUsers).where(eq(appUsers.email, email.toLowerCase())).get();
    if (existing) {
      return db.update(appUsers).set({ magicToken: token, magicExpiry: expiry })
        .where(eq(appUsers.email, email.toLowerCase())).returning().get()!;
    }
    return db.insert(appUsers).values({
      email: email.toLowerCase(), magicToken: token, magicExpiry: expiry,
      createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString(),
    }).returning().get();
  },

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
};
