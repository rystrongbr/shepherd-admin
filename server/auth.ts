import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { sql } from "drizzle-orm";
import { db } from "./storage";

export type UserClaims = { id: number; email: string; tier: "free" | "plus" | "enterprise" };
export type AdminClaims = { id: number; email: string; role: string };

declare global {
  namespace Express {
    interface Request {
      user?: UserClaims;
      admin?: AdminClaims;
    }
  }
}

const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || "15m";
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || "30d";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 256 bits before authentication can start");
  }
  return value;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function expirationMs(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return Number(match[1]) * multiplier;
}

export function ensureAuthTables(): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      subject_type TEXT NOT NULL,
      subject_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_refresh_subject ON auth_refresh_tokens(subject_type, subject_id)`);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);
}

export function seedInitialAdmin(): void {
  ensureAuthTables();
  const count = db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM admin_users`);
  if ((count?.count || 0) > 0) return;
  const password = randomBytes(24).toString("base64url");
  const passwordHash = bcrypt.hashSync(password, 12);
  db.run(sql`
    INSERT INTO admin_users (email, password_hash, role, created_at, is_active)
    VALUES ('ryan@myshepherdapp.church', ${passwordHash}, 'owner', ${new Date().toISOString()}, 1)
  `);
  // Deliberately the only time this password is emitted. Do not change this to
  // structured request logging; Railway deployment logs are Ryan's recovery path.
  console.log(`[security] Initial admin password for ryan@myshepherdapp.church: ${password}`);
}

function createRefresh(subjectType: "user" | "admin", subjectId: number): string {
  const value = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + expirationMs(REFRESH_EXPIRY)).toISOString();
  db.run(sql`
    INSERT INTO auth_refresh_tokens (token_hash, subject_type, subject_id, expires_at)
    VALUES (${hash(value)}, ${subjectType}, ${subjectId}, ${expiresAt})
  `);
  return value;
}

function userAccessToken(user: UserClaims): string {
  return jwt.sign({ ...user, kind: "user" }, secret(), { expiresIn: ACCESS_EXPIRY as jwt.SignOptions["expiresIn"] });
}

function adminAccessToken(admin: AdminClaims): string {
  return jwt.sign({ ...admin, kind: "admin" }, secret(), { expiresIn: ACCESS_EXPIRY as jwt.SignOptions["expiresIn"] });
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function sendTokens(res: Response, accessToken: string, refreshToken: string, kind: "user" | "admin") {
  res.cookie(`${kind}_access_token`, accessToken, cookieOptions(expirationMs(ACCESS_EXPIRY)));
  res.cookie(`${kind}_refresh_token`, refreshToken, cookieOptions(expirationMs(REFRESH_EXPIRY)));
  // Returning both enables native clients to store tokens in platform secure
  // storage. Web clients rely on the httpOnly cookies above.
  return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: ACCESS_EXPIRY };
}

export function issueUserTokens(res: Response, user: UserClaims) {
  return sendTokens(res, userAccessToken(user), createRefresh("user", user.id), "user");
}

export function issueAdminTokens(res: Response, admin: AdminClaims) {
  return sendTokens(res, adminAccessToken(admin), createRefresh("admin", admin.id), "admin");
}

function bearerOrCookie(req: Request, cookieName: string): string | undefined {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookieHeader = req.header("cookie") || "";
  const found = cookieHeader.split(";").map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`));
  return found ? decodeURIComponent(found.slice(cookieName.length + 1)) : undefined;
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = bearerOrCookie(req, "user_access_token");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const claims = jwt.verify(token, secret()) as jwt.JwtPayload;
    if (claims.kind !== "user" || typeof claims.id !== "number" || typeof claims.email !== "string") throw new Error("invalid token");
    const tier = claims.tier === "plus" || claims.tier === "enterprise" ? claims.tier : "free";
    req.user = { id: claims.id, email: claims.email, tier };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }
}

/** Attaches a valid consumer actor without rejecting anonymous routes. */
export function attachUserIfPresent(req: Request, _res: Response, next: NextFunction) {
  const token = bearerOrCookie(req, "user_access_token");
  if (!token) return next();
  try {
    const claims = jwt.verify(token, secret()) as jwt.JwtPayload;
    if (claims.kind === "user" && typeof claims.id === "number" && typeof claims.email === "string") {
      req.user = {
        id: claims.id,
        email: claims.email,
        tier: claims.tier === "plus" || claims.tier === "enterprise" ? claims.tier : "free",
      };
    }
  } catch {
    // Protected endpoints give a uniform 401 via requireUser. Public endpoints
    // continue as anonymous rather than exposing JWT parsing detail.
  }
  return next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = bearerOrCookie(req, "admin_access_token");
  if (!token) return res.status(401).json({ error: "Administrator authentication required" });
  try {
    const claims = jwt.verify(token, secret()) as jwt.JwtPayload;
    if (claims.kind !== "admin" || typeof claims.id !== "number" || typeof claims.email !== "string") throw new Error("invalid token");
    req.admin = { id: claims.id, email: claims.email, role: String(claims.role || "admin") };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired administrator token" });
  }
}

export function refreshTokens(req: Request, res: Response, kind: "user" | "admin", lookup: (id: number) => UserClaims | AdminClaims | undefined) {
  const token = req.body?.refreshToken || bearerOrCookie(req, `${kind}_refresh_token`);
  if (typeof token !== "string" || !token) return res.status(401).json({ error: "Refresh token required" });
  const row = db.get<{ id: number; subject_id: number; expires_at: string; revoked_at: string | null }>(sql`
    SELECT id, subject_id, expires_at, revoked_at FROM auth_refresh_tokens
    WHERE token_hash = ${hash(token)} AND subject_type = ${kind}
  `);
  if (!row || row.revoked_at || new Date(row.expires_at) <= new Date()) return res.status(401).json({ error: "Invalid or expired refresh token" });
  const subject = lookup(row.subject_id);
  if (!subject) return res.status(401).json({ error: "Account is unavailable" });
  db.run(sql`UPDATE auth_refresh_tokens SET revoked_at = ${new Date().toISOString()} WHERE id = ${row.id}`);
  return kind === "user"
    ? res.json(issueUserTokens(res, subject as UserClaims))
    : res.json(issueAdminTokens(res, subject as AdminClaims));
}

export async function verifyGoogleIdToken(idToken: string) {
  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience) throw new Error("GOOGLE_CLIENT_ID is not configured");
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    audience,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  if (payload.email_verified !== true || typeof payload.email !== "string" || typeof payload.sub !== "string") {
    throw new Error("Google account email is not verified");
  }
  return { email: payload.email, name: typeof payload.name === "string" ? payload.name : "", googleId: payload.sub };
}

export function findAdminByEmail(email: string) {
  return db.get<{ id: number; email: string; password_hash: string; role: string; is_active: number }>(
    sql`SELECT id, email, password_hash, role, is_active FROM admin_users WHERE lower(email) = lower(${email})`,
  );
}

export function findAdminById(id: number): AdminClaims | undefined {
  const row = db.get<{ id: number; email: string; role: string; is_active: number }>(
    sql`SELECT id, email, role, is_active FROM admin_users WHERE id = ${id}`,
  );
  return row?.is_active ? { id: row.id, email: row.email, role: row.role } : undefined;
}

export function createAdmin(email: string, password: string, role = "admin"): AdminClaims {
  if (password.length < 14) throw new Error("Admin passwords must be at least 14 characters");
  const normalized = email.trim().toLowerCase();
  const passwordHash = bcrypt.hashSync(password, 12);
  db.run(sql`INSERT INTO admin_users (email, password_hash, role, created_at, is_active)
    VALUES (${normalized}, ${passwordHash}, ${role}, ${new Date().toISOString()}, 1)`);
  const created = findAdminByEmail(normalized);
  if (!created) throw new Error("Unable to create administrator");
  return { id: created.id, email: created.email, role: created.role };
}
