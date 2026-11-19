import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import type Database from "better-sqlite3";
import { createHash, timingSafeEqual } from "node:crypto";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

/**
 * Read-only, aggregate-only marketing funnel metrics.
 *
 * GET /api/admin/metrics/marketing?days=30[&includeInternal=true]
 *
 * Auth (either):
 *   - the existing admin session (admin JWT via `Authorization: Bearer` or the
 *     `admin_access_token` cookie, verified by `requireAdmin`), or
 *   - `Authorization: Bearer <MARKETING_METRICS_TOKEN>` for automations. The
 *     token only unlocks this endpoint. When the env var is unset (or shorter
 *     than 32 characters) the token path is disabled.
 *
 * Guarantees:
 *   - Every statement is a SELECT; each prepared statement is checked with
 *     better-sqlite3's `stmt.readonly` before it runs, so a write can never
 *     slip in through this module.
 *   - Output is counts/sums grouped by day, tier, product, platform or
 *     attribution label only. No emails, names, ZIPs, church names, question
 *     text, user/session/transaction IDs leave this module.
 *   - Tables that are created lazily (quota counts, launch waitlist) are
 *     probed first; a missing table yields zeros, never an error.
 *
 * Mounted before the blanket `/api` admin gate (same pattern as the waitlist
 * routes) so the token path works without touching the gate's allowlist.
 */

export const MARKETING_METRICS_PATH = "/api/admin/metrics/marketing";
export const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;
const MIN_TOKEN_LENGTH = 32;
const TOP_N = 25;
const INTERNAL_EMAIL_SUFFIX = "@myshepherdapp.church";
const DAILY_LIMITS = { free: 3, plus: 20, enterprise: 50 } as const;

export type MarketingMetricsDeps = {
  sqlite: Database.Database;
  requireAdmin: RequestHandler;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

type Count = { n: number };
type DayCount = { day: string; n: number };

const sha = (value: string) => createHash("sha256").update(value).digest();

function tokenMatches(presented: string, expected: string | undefined): boolean {
  if (!expected || expected.length < MIN_TOKEN_LENGTH) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  return timingSafeEqual(sha(presented), sha(expected));
}

export function parseDays(raw: unknown): number | null {
  if (raw === undefined || raw === "") return DEFAULT_DAYS;
  if (typeof raw !== "string" || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1) return null;
  return Math.min(n, MAX_DAYS);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`).getTime();
  while (cursor.getTime() <= last) {
    out.push(isoDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function computeMarketingMetrics(
  sqlite: Database.Database,
  options: { days: number; includeInternal: boolean; now?: Date },
) {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const endDate = isoDay(now);
  const startDay = new Date(`${endDate}T00:00:00.000Z`);
  startDay.setUTCDate(startDay.getUTCDate() - (options.days - 1));
  const startDate = isoDay(startDay);
  const days = dayRange(startDate, endDate);

  function stmt(source: string) {
    const prepared = sqlite.prepare(source);
    if (!prepared.readonly) throw new Error("marketing metrics: refusing non-read-only statement");
    return prepared;
  }
  const all = <T>(source: string, ...params: unknown[]) => stmt(source).all(...params) as T[];
  const get = <T>(source: string, ...params: unknown[]) => stmt(source).get(...params) as T | undefined;

  const tableNames = new Set(
    all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`).map(r => r.name),
  );
  const has = (table: string) => tableNames.has(table);
  const columns = (table: string) =>
    has(table) ? new Set(all<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, table).map(r => r.name)) : new Set<string>();
  const userCols = columns("app_users");
  const hasUsers = has("app_users");

  // Internal = flagged test users + staff/reviewer accounts on our own domain.
  const internalPredicate = [
    userCols.has("is_test_user") ? "COALESCE(u.is_test_user, 0) = 1" : null,
    `lower(u.email) LIKE '%${INTERNAL_EMAIL_SUFFIX}'`,
  ].filter(Boolean).join(" OR ");
  const userFilter = options.includeInternal ? "1 = 1" : `NOT (${internalPredicate})`;

  // Mirrors server/iap/effective-tier.ts: a paid tier with a product id is only
  // paid while its stored expiry is in the future; manual grants stay paid.
  const hasSubCols = userCols.has("subscription_product_id") && userCols.has("subscription_expires_at");
  const tierCol = userCols.has("tier") ? "u.tier" : "'free'";
  const effectiveTierSql = hasSubCols
    ? `CASE
        WHEN ${tierCol} NOT IN ('plus', 'enterprise') THEN 'free'
        WHEN u.subscription_product_id IS NULL OR u.subscription_product_id = '' THEN ${tierCol}
        WHEN u.subscription_expires_at > ? THEN ${tierCol}
        ELSE 'free' END`
    : `CASE WHEN ${tierCol} IN ('plus', 'enterprise') THEN ${tierCol} ELSE 'free' END`;
  const tierParams = hasSubCols ? [nowIso] : [];

  const series = (rows: DayCount[]) => new Map(rows.map(r => [r.day, Number(r.n) || 0]));

  // ─── Users ────────────────────────────────────────────────────────────────
  const usersByTier = { free: 0, plus: 0, enterprise: 0 };
  let totalUsers = 0;
  let excludedInternalUsers = 0;
  const usersByAuthMethod = { google: 0, emailMagicLink: 0 };
  let signupsByDay = new Map<string, number>();
  let usersWithChurchAffiliation = 0;
  let usersWithHomeChurchName = 0;
  if (hasUsers) {
    for (const row of all<{ t: string; n: number }>(
      `SELECT ${effectiveTierSql} AS t, COUNT(*) AS n FROM app_users u WHERE ${userFilter} GROUP BY t`,
      ...tierParams,
    )) {
      if (row.t in usersByTier) usersByTier[row.t as keyof typeof usersByTier] += row.n;
      totalUsers += row.n;
    }
    if (!options.includeInternal) {
      excludedInternalUsers = get<Count>(`SELECT COUNT(*) AS n FROM app_users u WHERE ${internalPredicate}`)?.n ?? 0;
    }
    if (userCols.has("google_id")) {
      usersByAuthMethod.google = get<Count>(
        `SELECT COUNT(*) AS n FROM app_users u WHERE ${userFilter} AND COALESCE(u.google_id, '') <> ''`,
      )?.n ?? 0;
      usersByAuthMethod.emailMagicLink = totalUsers - usersByAuthMethod.google;
    }
    signupsByDay = series(all<DayCount>(
      `SELECT substr(u.created_at, 1, 10) AS day, COUNT(*) AS n FROM app_users u
       WHERE ${userFilter} AND substr(u.created_at, 1, 10) BETWEEN ? AND ? GROUP BY day`,
      startDate, endDate,
    ));
    if (userCols.has("church_id")) {
      usersWithChurchAffiliation = get<Count>(
        `SELECT COUNT(*) AS n FROM app_users u WHERE ${userFilter} AND u.church_id IS NOT NULL`,
      )?.n ?? 0;
    }
    if (userCols.has("home_church_name")) {
      usersWithHomeChurchName = get<Count>(
        `SELECT COUNT(*) AS n FROM app_users u WHERE ${userFilter} AND COALESCE(trim(u.home_church_name), '') <> ''`,
      )?.n ?? 0;
    }
  }
  const paidUsers = usersByTier.plus + usersByTier.enterprise;

  // ─── Subscriptions ────────────────────────────────────────────────────────
  const activeByProduct: Record<string, number> = {};
  const activeByPlatform = { apple: 0, google: 0 };
  const manualGrants = { plus: 0, enterprise: 0 };
  let lapsedAllTime = 0;
  let lapsesByDay = new Map<string, number>();
  if (hasUsers && hasSubCols) {
    const platformSql = userCols.has("subscription_platform")
      ? `CASE WHEN u.subscription_platform = 'google' THEN 'google' ELSE 'apple' END`
      : `'apple'`;
    for (const row of all<{ product: string; platform: string; n: number }>(
      `SELECT u.subscription_product_id AS product, ${platformSql} AS platform, COUNT(*) AS n
       FROM app_users u
       WHERE ${userFilter} AND ${tierCol} IN ('plus', 'enterprise')
         AND COALESCE(u.subscription_product_id, '') <> '' AND u.subscription_expires_at > ?
       GROUP BY product, platform`,
      nowIso,
    )) {
      activeByProduct[row.product] = (activeByProduct[row.product] ?? 0) + row.n;
      activeByPlatform[row.platform as "apple" | "google"] += row.n;
    }
    for (const row of all<{ t: string; n: number }>(
      `SELECT ${tierCol} AS t, COUNT(*) AS n FROM app_users u
       WHERE ${userFilter} AND ${tierCol} IN ('plus', 'enterprise') AND COALESCE(u.subscription_product_id, '') = ''
       GROUP BY t`,
    )) manualGrants[row.t as "plus" | "enterprise"] = row.n;
    // A store subscription whose stored expiry is in the past and was never
    // extended by a later verified renewal.
    const lapsedWhere = `${userFilter} AND COALESCE(u.subscription_product_id, '') <> ''
      AND u.subscription_expires_at IS NOT NULL AND u.subscription_expires_at <= ?`;
    lapsedAllTime = get<Count>(`SELECT COUNT(*) AS n FROM app_users u WHERE ${lapsedWhere}`, nowIso)?.n ?? 0;
    lapsesByDay = series(all<DayCount>(
      `SELECT substr(u.subscription_expires_at, 1, 10) AS day, COUNT(*) AS n FROM app_users u
       WHERE ${lapsedWhere} AND substr(u.subscription_expires_at, 1, 10) BETWEEN ? AND ? GROUP BY day`,
      nowIso, startDate, endDate,
    ));
  }

  // ─── Signed-in usage (server-side quota ledger, all clients) ─────────────
  let activeAskersByDay = new Map<string, number>();
  let authQuestionsByDay = new Map<string, number>();
  let atLimitByDay = new Map<string, number>();
  let activeAskersInWindow = 0;
  if (has("daily_question_counts") && hasUsers) {
    const rows = all<{ day: string; askers: number; questions: number; atLimit: number }>(
      `SELECT q.date AS day, COUNT(DISTINCT q.user_id) AS askers, SUM(q.count) AS questions,
         SUM(CASE WHEN q.count >= (CASE ${effectiveTierSql}
             WHEN 'enterprise' THEN ${DAILY_LIMITS.enterprise}
             WHEN 'plus' THEN ${DAILY_LIMITS.plus}
             ELSE ${DAILY_LIMITS.free} END) THEN 1 ELSE 0 END) AS atLimit
       FROM daily_question_counts q JOIN app_users u ON u.id = q.user_id
       WHERE ${userFilter} AND q.date BETWEEN ? AND ? GROUP BY q.date`,
      ...tierParams, startDate, endDate,
    );
    activeAskersByDay = new Map(rows.map(r => [r.day, r.askers]));
    authQuestionsByDay = new Map(rows.map(r => [r.day, Number(r.questions) || 0]));
    atLimitByDay = new Map(rows.map(r => [r.day, Number(r.atLimit) || 0]));
    activeAskersInWindow = get<Count>(
      `SELECT COUNT(DISTINCT q.user_id) AS n FROM daily_question_counts q JOIN app_users u ON u.id = q.user_id
       WHERE ${userFilter} AND q.date BETWEEN ? AND ?`,
      startDate, endDate,
    )?.n ?? 0;
  }

  // ─── Web questions (client-logged insights; web app only, incl. anonymous)
  let webQuestionsByDay = new Map<string, number>();
  let webSignedInByDay = new Map<string, number>();
  let webAnonSessionsByDay = new Map<string, number>();
  if (has("insights")) {
    const rows = all<{ day: string; total: number; signedIn: number; anonSessions: number }>(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS total,
         SUM(CASE WHEN session_id LIKE 'user-%' THEN 1 ELSE 0 END) AS signedIn,
         COUNT(DISTINCT CASE WHEN session_id <> '' AND session_id NOT LIKE 'user-%' THEN session_id END) AS anonSessions
       FROM insights WHERE substr(created_at, 1, 10) BETWEEN ? AND ? GROUP BY day`,
      startDate, endDate,
    );
    webQuestionsByDay = new Map(rows.map(r => [r.day, r.total]));
    webSignedInByDay = new Map(rows.map(r => [r.day, Number(r.signedIn) || 0]));
    webAnonSessionsByDay = new Map(rows.map(r => [r.day, r.anonSessions]));
  }

  // ─── Donations (Stripe, web) ─────────────────────────────────────────────
  let donationsByDay = new Map<string, number>();
  let donationCentsByDay = new Map<string, number>();
  const donationAmountCentsByCurrency: Record<string, number> = {};
  const donationsByFrequency: Record<string, number> = {};
  let donationsInWindow = 0;
  if (has("donations")) {
    // completed_at is set on completion; fall back to created_at for old rows.
    const dayExpr = `substr(CASE WHEN COALESCE(completed_at, '') <> '' THEN completed_at ELSE created_at END, 1, 10)`;
    const where = `status = 'completed' AND ${dayExpr} BETWEEN ? AND ?`;
    const rows = all<{ day: string; n: number; cents: number }>(
      `SELECT ${dayExpr} AS day, COUNT(*) AS n, SUM(amount_cents) AS cents FROM donations WHERE ${where} GROUP BY day`,
      startDate, endDate,
    );
    donationsByDay = new Map(rows.map(r => [r.day, r.n]));
    donationCentsByDay = new Map(rows.map(r => [r.day, Number(r.cents) || 0]));
    donationsInWindow = rows.reduce((sum, r) => sum + r.n, 0);
    for (const r of all<{ k: string; cents: number }>(
      `SELECT lower(currency) AS k, SUM(amount_cents) AS cents FROM donations WHERE ${where} GROUP BY k`, startDate, endDate,
    )) donationAmountCentsByCurrency[r.k] = Number(r.cents) || 0;
    for (const r of all<{ k: string; n: number }>(
      `SELECT frequency AS k, COUNT(*) AS n FROM donations WHERE ${where} GROUP BY k`, startDate, endDate,
    )) donationsByFrequency[r.k] = r.n;
  }

  // ─── Attribution: stay-connected signups and the launch waitlist ─────────
  let memberSignupsByDay = new Map<string, number>();
  const memberSignupsBySource: Record<string, number> = {};
  if (has("member_signups")) {
    memberSignupsByDay = series(all<DayCount>(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM member_signups
       WHERE substr(created_at, 1, 10) BETWEEN ? AND ? GROUP BY day`, startDate, endDate,
    ));
    for (const r of all<{ k: string; n: number }>(
      `SELECT source AS k, COUNT(*) AS n FROM member_signups
       WHERE substr(created_at, 1, 10) BETWEEN ? AND ? GROUP BY k ORDER BY n DESC LIMIT ${TOP_N}`, startDate, endDate,
    )) memberSignupsBySource[r.k || "(none)"] = r.n;
  }

  let waitlistByDay = new Map<string, number>();
  const waitlist = {
    available: has("launch_waitlist"),
    totalSubscribed: 0,
    signupsInWindow: 0,
    byDevice: {} as Record<string, number>,
    bySource: {} as Record<string, number>,
    byMedium: {} as Record<string, number>,
    byCampaign: {} as Record<string, number>,
  };
  if (waitlist.available) {
    const inWindow = `substr(created_at, 1, 10) BETWEEN ? AND ?`;
    waitlist.totalSubscribed = get<Count>(
      `SELECT COUNT(*) AS n FROM launch_waitlist WHERE status = 'subscribed'`,
    )?.n ?? 0;
    waitlistByDay = series(all<DayCount>(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM launch_waitlist WHERE ${inWindow} GROUP BY day`,
      startDate, endDate,
    ));
    waitlist.signupsInWindow = Array.from(waitlistByDay.values()).reduce((a, b) => a + b, 0);
    const group = (column: "device" | "source" | "medium" | "campaign") => {
      const out: Record<string, number> = {};
      for (const r of all<{ k: string; n: number }>(
        `SELECT ${column} AS k, COUNT(*) AS n FROM launch_waitlist WHERE ${inWindow}
         GROUP BY k ORDER BY n DESC LIMIT ${TOP_N}`, startDate, endDate,
      )) out[r.k || "(none)"] = r.n;
      return out;
    };
    waitlist.byDevice = group("device");
    waitlist.bySource = group("source");
    waitlist.byMedium = group("medium");
    waitlist.byCampaign = group("campaign");
  }

  const daily = days.map(date => ({
    date,
    signups: signupsByDay.get(date) ?? 0,
    activeAskers: activeAskersByDay.get(date) ?? 0,
    signedInQuestions: authQuestionsByDay.get(date) ?? 0,
    usersAtDailyLimit: atLimitByDay.get(date) ?? 0,
    webQuestions: webQuestionsByDay.get(date) ?? 0,
    webQuestionsSignedIn: webSignedInByDay.get(date) ?? 0,
    webQuestionsAnonymous: (webQuestionsByDay.get(date) ?? 0) - (webSignedInByDay.get(date) ?? 0),
    webAnonymousSessions: webAnonSessionsByDay.get(date) ?? 0,
    subscriptionLapses: lapsesByDay.get(date) ?? 0,
    donations: donationsByDay.get(date) ?? 0,
    donationAmountCents: donationCentsByDay.get(date) ?? 0,
    stayConnectedSignups: memberSignupsByDay.get(date) ?? 0,
    waitlistSignups: waitlistByDay.get(date) ?? 0,
  }));
  const sum = (key: keyof (typeof daily)[number]) =>
    daily.reduce((acc, d) => acc + (typeof d[key] === "number" ? (d[key] as number) : 0), 0);

  return {
    schemaVersion: 1,
    generatedAt: nowIso,
    window: { days: options.days, startDate, endDate, timezone: "UTC" },
    filters: { includeInternal: options.includeInternal, excludedInternalUsers },
    totals: {
      users: totalUsers,
      usersByTier,
      paidUsers,
      paidShareOfUsers: totalUsers ? Number((paidUsers / totalUsers).toFixed(4)) : 0,
      usersByAuthMethod,
      usersWithChurchAffiliation,
      usersWithHomeChurchName,
    },
    windowTotals: {
      signups: sum("signups"),
      activeAskers: activeAskersInWindow,
      signedInQuestions: sum("signedInQuestions"),
      userDaysAtDailyLimit: sum("usersAtDailyLimit"),
      webQuestions: sum("webQuestions"),
      subscriptionLapses: sum("subscriptionLapses"),
      donations: donationsInWindow,
      stayConnectedSignups: sum("stayConnectedSignups"),
      waitlistSignups: sum("waitlistSignups"),
    },
    subscriptions: {
      activeByProduct,
      activeByPlatform,
      manualGrants,
      lapsedAllTime,
    },
    donations: { amountCentsByCurrency: donationAmountCentsByCurrency, byFrequency: donationsByFrequency },
    attribution: { stayConnectedSignupsBySource: memberSignupsBySource, launchWaitlist: waitlist },
    daily,
    definitions: {
      usersByTier: "Effective tier now (store subscriptions count as paid only until their stored expiry; manual grants always count).",
      signups: "app_users rows created on that UTC day.",
      activeAskers: "Distinct signed-in users with at least one quota-counted question that day (all clients; date is the user's local day when the client sends its timezone, else UTC).",
      signedInQuestions: "Quota-counted signed-in requests (ask, scripture, deeper, passage) that day.",
      usersAtDailyLimit: "Signed-in users whose count reached their CURRENT tier's daily limit (3/20/50) that day. Blocked attempts after the limit are not stored.",
      webQuestions: "Questions logged by the web app via /api/insights/log (web only; mobile does not log here). Anonymous vs signed-in split by session tag.",
      subscriptionLapses: "Store subscriptions whose stored expiry fell on that day and was not extended by a later verified renewal. Apple renewals only extend the stored expiry when the app re-syncs, so recent days can over-count.",
      donations: "Completed Stripe donations (web).",
      stayConnectedSignups: "member_signups rows (first-visit stay-connected modal), grouped by their source label.",
      launchWaitlist: "Pre-launch waitlist signups with self-reported device and UTM-style source/medium/campaign labels (top 25 each).",
      internal: `Excluded by default: is_test_user = 1 or email ending ${INTERNAL_EMAIL_SUFFIX} (staff and store-review accounts). Pass includeInternal=true to include them.`,
    },
    notDerivable: [
      "Signup platform (ios/android/web) for app users: no platform is stored at account creation. Paid subscriptions are split by store (apple/google) instead.",
      "New paid conversions/upgrades per day: no first-purchase timestamp or subscription event history is stored (subscription_updated_at changes on every sync).",
      "Cancellations / auto-renew turned off: renewal intent is not persisted; only expiry-based lapses are derivable.",
      "Trial starts/conversions and refunds: not stored.",
      "Anonymous (signed-out) limit hits and mobile signed-out usage: anonymous limits are enforced in memory per IP and not persisted.",
      "Signup source/referral/UTM for app users: not captured on app_users (only the waitlist and stay-connected modal carry source labels).",
      "Paywall/upgrade-screen views and limit-reached prompts shown: not tracked server-side.",
    ],
  };
}

export function registerMarketingMetrics(app: Express, deps: MarketingMetricsDeps) {
  const env = deps.env ?? process.env;
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    keyGenerator: req => ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown"),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests." },
  });

  const guard = (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    if (header?.startsWith("Bearer ") && tokenMatches(header.slice(7), env.MARKETING_METRICS_TOKEN)) {
      return next();
    }
    // Falls through to the existing admin JWT/cookie check (uniform 401s).
    return deps.requireAdmin(req, res, next);
  };

  app.get(MARKETING_METRICS_PATH, limiter, guard, (req, res) => {
    res.set("Cache-Control", "no-store");
    const days = parseDays(req.query.days);
    if (days === null) return res.status(400).json({ error: `days must be an integer between 1 and ${MAX_DAYS}` });
    const includeInternal = req.query.includeInternal === "true" || req.query.includeInternal === "1";
    try {
      return res.json(computeMarketingMetrics(deps.sqlite, { days, includeInternal, now: deps.now?.() }));
    } catch (error) {
      console.error("[marketing-metrics] failed:", error instanceof Error ? error.message : "unknown error");
      return res.status(500).json({ error: "Metrics unavailable" });
    }
  });
}
