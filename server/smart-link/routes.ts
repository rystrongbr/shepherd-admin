import type { Express, Request, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { detectPlatform, sanitizeLabel, type Platform } from "./detect";
import { renderFallbackPage } from "./page";
import type { SmartLinkClick } from "./store";

/**
 * Public smart download link: GET /get (alias /download).
 *
 *   iPhone / iPad / iPod (incl. in-app webviews) -> 302 App Store
 *   Android (incl. in-app webviews)              -> 302 Google Play (+ install referrer)
 *   desktop / unknown / crawlers                 -> 200 fallback page with both badges
 *
 * Registered in registerRoutes() next to the waitlist, i.e. before the /api
 * auth gate and before the production SPA catch-all in server/index.ts, so it
 * never touches auth, /api, /api/v1, AASA/assetlinks or legal pages.
 *
 * Click logging is fire-and-forget after the response is sent and can never
 * block or break the redirect. Rate limiting only throttles *logging* (so a
 * flood can't bloat the table); redirects are always served, because Railway
 * fronts us with a proxy and trust proxy is off, so many real users may share
 * one req.ip during a podcast spike.
 */

export const APP_STORE_URL = "https://apps.apple.com/us/app/id6804705145";
export const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=church.myshepherdapp";
export const SMART_LINK_PATHS = ["/get", "/download"];

export type SmartLinkDeps = {
  record: (click: SmartLinkClick) => void;
  env?: NodeJS.ProcessEnv;
  /** Test seam; defaults to setImmediate so logging runs after the response. */
  defer?: (fn: () => void) => void;
};

export function googlePlayUrl(src: string, campaign: string): string {
  // Play install referrer: the whole referrer value is one URL-encoded param.
  let referrer = `utm_source=${src}&utm_medium=smartlink`;
  if (campaign) referrer += `&utm_campaign=${campaign}`;
  return `${GOOGLE_PLAY_URL}&referrer=${encodeURIComponent(referrer)}`;
}

export function registerSmartLink(app: Express, deps: SmartLinkDeps) {
  const env = deps.env ?? process.env;
  const defer = deps.defer ?? ((fn: () => void) => { setImmediate(fn); });

  // Generous per-IP cap that only gates click logging (see header comment).
  const logLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    keyGenerator: req => ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown"),
    standardHeaders: false,
    legacyHeaders: false,
    handler: (_req, res, next) => {
      res.locals.smartLinkSkipLog = true;
      next();
    },
  });

  const logClick = (req: Request, res: Response, click: SmartLinkClick) => {
    if (req.method !== "GET") return; // HEAD = link unfurlers / uptime checks
    if (res.locals.smartLinkSkipLog) return;
    if (env.SMART_LINK_LOGGING_ENABLED === "false") return;
    defer(() => {
      try {
        deps.record(click);
      } catch (error) {
        console.error("[smart-link] click log failed:", error instanceof Error ? error.message : "unknown error");
      }
    });
  };

  const handler = (req: Request, res: Response) => {
    const src = sanitizeLabel(req.query.src, "unknown");
    const campaign = sanitizeLabel(req.query.campaign, "");
    let platform: Platform = "other";
    try {
      platform = detectPlatform(req.get("user-agent")).platform;
    } catch { /* fall through to the page */ }

    res.set("Cache-Control", "no-store");
    // Response depends on the UA; keep any intermediary cache honest.
    res.append("Vary", "User-Agent");
    res.set("X-Robots-Tag", "noindex");

    if (platform === "ios") {
      res.redirect(302, APP_STORE_URL);
    } else if (platform === "android") {
      res.redirect(302, googlePlayUrl(src, campaign));
    } else {
      res.status(200).type("html").send(renderFallbackPage({
        appStore: APP_STORE_URL,
        googlePlay: googlePlayUrl(src, campaign),
      }));
    }
    try {
      logClick(req, res, { src, campaign, platform });
    } catch { /* never let logging affect the response */ }
  };

  for (const path of SMART_LINK_PATHS) {
    // Exact path or a single trailing slash; nothing deeper.
    app.get(new RegExp(`^${path}/?$`), logLimiter, handler);
  }
}
