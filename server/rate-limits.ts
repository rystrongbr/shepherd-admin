import type { NextFunction, Request, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { db } from "./storage";

const CAPACITY_MESSAGE = "We're at capacity right now. Please try again in a moment.";
const anonymousLimit = Number(process.env.RATE_LIMIT_ANONYMOUS_PER_DAY || 3);
const maxConcurrent = Number(process.env.ANTHROPIC_MAX_CONCURRENT || 20);

export const anonymousQuestionLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: anonymousLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: req => ipKeyGenerator(req.ip || "127.0.0.1"),
  skip: req => Boolean(req.user),
  handler: (_req, res) => res.status(429).json({ error: "Daily question limit reached. Please come back tomorrow." }),
});

export function ensureQuotaTables() {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS daily_question_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, date)
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_daily_question_counts_user_date ON daily_question_counts(user_id, date)`);
}

function localDate(req: Request): string {
  // Clients may provide an IANA zone for a correct local-midnight boundary;
  // malformed/missing zones deliberately fall back to UTC.
  const timezone = typeof req.header("x-user-timezone") === "string" ? req.header("x-user-timezone") : "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}

export function authenticatedQuestionQuota(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return next();
  if (process.env.RATE_LIMIT_BYPASS === "true") return next();
  ensureQuotaTables();
  const max = req.user.tier === "enterprise" ? 50 : req.user.tier === "plus" ? 20 : 3;
  const date = localDate(req);
  const current = db.get<{ count: number }>(sql`
    SELECT count FROM daily_question_counts WHERE user_id = ${req.user.id} AND date = ${date}
  `);
  if ((current?.count || 0) >= max) {
    return res.status(429).json({ error: "Daily question limit reached. Please come back tomorrow.", limit: max });
  }
  // SQLite test implementation. The Postgres migration has the equivalent
  // unique key and uses the same atomic upsert statement in production adapter.
  db.run(sql`
    INSERT INTO daily_question_counts (user_id, date, count, created_at, updated_at)
    VALUES (${req.user.id}, ${date}, 1, ${new Date().toISOString()}, ${new Date().toISOString()})
    ON CONFLICT(user_id, date) DO UPDATE SET count = daily_question_counts.count + 1, updated_at = excluded.updated_at
  `);
  return next();
}

class AnthropicQueue {
  private running = 0;
  private pending: Array<() => void> = [];

  get depth() {
    return this.pending.length;
  }

  async execute<T>(work: () => Promise<T>): Promise<T> {
    if (this.pending.length > 100) throw new CapacityError();
    await new Promise<void>((resolve, reject) => {
      if (this.running < maxConcurrent) {
        this.running += 1;
        resolve();
        return;
      }
      if (this.pending.length >= 40) {
        reject(new CapacityError());
        return;
      }
      this.pending.push(() => {
        this.running += 1;
        resolve();
      });
    });
    try {
      return await work();
    } finally {
      this.running -= 1;
      this.pending.shift()?.();
    }
  }
}

export class CapacityError extends Error {
  constructor() {
    super(CAPACITY_MESSAGE);
  }
}

export const anthropicQueue = new AnthropicQueue();

export async function queueAnthropic<T>(res: Response, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await anthropicQueue.execute(work);
  } catch (error) {
    if (error instanceof CapacityError) {
      res.status(429).json({ error: CAPACITY_MESSAGE });
      return undefined;
    }
    throw error;
  }
}
