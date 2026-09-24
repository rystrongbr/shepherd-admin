import type { Express, Response } from "express";
import bcrypt from "bcryptjs";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

// Deliberately fixed identities: this is not general password authentication,
// account provisioning, or an administrator login.
export const REVIEWER_ACCOUNTS = {
  "apple-review@myshepherdapp.church": "REVIEWER_ENTERPRISE_PASSWORD_HASH",
  "apple-review+free@myshepherdapp.church": "REVIEWER_FREE_PASSWORD_HASH",
} as const;

type ReviewerUser = {
  id: number;
  email: string;
  name: string | null;
  churchId: number | null;
  tier?: string | null;
};
type Claims = { id: number; email: string; tier: "free" | "plus" | "enterprise" };
type Dependencies = {
  findUser: (email: string) => ReviewerUser | undefined;
  issueTokens: (res: Response, user: Claims) => object;
  env?: NodeJS.ProcessEnv;
};

// Cost 12 only: rejects plaintext and accidental/unsafe bcrypt cost settings.
const validHash = (value: string | undefined): value is string =>
  typeof value === "string" && /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(value);
const invalidCredentials = { error: "Invalid reviewer email or password." };
const unavailable = { error: "Reviewer sign-in is unavailable. Please contact support." };

export function registerReviewerSignin(app: Express, deps: Dependencies) {
  const env = deps.env ?? process.env;
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Honor Express' existing proxy policy, not arbitrary X-Forwarded-For or
    // CF headers supplied by a caller. With trust proxy off this is conservative
    // (a proxy IP may be shared). Do not weaken trust proxy for this feature.
    keyGenerator: req => ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown"),
    message: { error: "Too many sign-in attempts. Please try again in 15 minutes." },
  });
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    keyGenerator: () => "reviewer-signin",
    standardHeaders: false,
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Please try again in 15 minutes." },
  });

  app.post("/api/user/reviewer-signin", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  }, limiter, globalLimiter, async (req, res) => {
    if (env.ENABLE_REVIEWER_SIGNIN !== "true") {
      return res.status(503).json(unavailable);
    }
    const paidHash = env.REVIEWER_ENTERPRISE_PASSWORD_HASH;
    const freeHash = env.REVIEWER_FREE_PASSWORD_HASH;
    if (!validHash(paidHash) || !validHash(freeHash)) {
      return res.status(503).json(unavailable);
    }
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || email.length > 254 ||
        typeof password !== "string" || !password.length ||
        Buffer.byteLength(password, "utf8") > 72) {
      return res.status(401).json(invalidCredentials);
    }
    const normalized = email.trim().toLowerCase();
    const allowed = Object.hasOwn(REVIEWER_ACCOUNTS, normalized);
    // Still perform a bcrypt check for unknown identities; never return tokens
    // for them even if they know a demo password.
    const hash = normalized === "apple-review+free@myshepherdapp.church" ? freeHash : paidHash;
    try {
      const matches = await bcrypt.compare(password, hash);
      if (!allowed || !matches) return res.status(401).json(invalidCredentials);
      const user = deps.findUser(normalized);
      if (!user || user.email.toLowerCase() !== normalized) {
        return res.status(503).json(unavailable);
      }
      // Read the real entitlement. Never reset tiers or fabricate a StoreKit
      // purchase here; sandbox purchases must survive sign-out and refresh.
      const tier = user.tier === "enterprise" || user.tier === "plus" ? user.tier : "free";
      const tokens = deps.issueTokens(res, { id: user.id, email: user.email, tier });
      return res.json({
        ok: true,
        user: { id: user.id, email: user.email, name: user.name, churchId: user.churchId },
        ...tokens,
      });
    } catch {
      // Do not log request bodies, passwords, hashes, tokens, or exception
      // payloads. Existing request logging records path/status/duration only.
      return res.status(503).json(unavailable);
    }
  });
}
