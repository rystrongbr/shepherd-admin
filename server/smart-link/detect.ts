/**
 * Device detection for the public smart download link (/get, /download).
 *
 * Deliberately small and dependency-free. Classifies a User-Agent into one of
 * four buckets; the raw UA is never stored or logged.
 *
 * Order matters:
 *   1. Crawlers / link-preview bots first (Googlebot smartphone UA contains
 *      "Android"; facebookexternalhit must get the HTML page + OG tags).
 *   2. iOS (iPhone/iPad/iPod, incl. Instagram/Facebook/TikTok/etc. in-app
 *      webviews, which keep the device token in their UA).
 *   3. Android (incl. in-app webviews: Instagram, FB_IAB, TikTok musical_ly,
 *      Threads, Snapchat, ...).
 *   4. Desktop OSes. iPadOS 13+ Safari sends a desktop "Macintosh" UA by
 *      default; that cannot be told apart server-side, so it lands on the
 *      fallback page whose inline script redirects touch-capable "Macs".
 */

export type Platform = "ios" | "android" | "desktop" | "other";
export type Detection = { platform: Platform; isBot: boolean };

// Named crawlers and link-preview fetchers only. Kept specific so in-app
// browsers (e.g. "[Pinterest/iOS]", "LinkedInApp", "Instagram") are NOT bots.
const BOT = /googlebot|google-inspectiontool|googleother|adsbot-google|mediapartners-google|bingbot|bingpreview|yandex(bot|images)|baiduspider|duckduckbot|slurp|applebot|petalbot|ahrefsbot|semrushbot|mj12bot|dotbot|crawler|spider|facebookexternalhit|facebookcatalog|meta-externalagent|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp\/|skypeuripreview|pinterestbot|redditbot|embedly|bitlybot|iframely|lighthouse|headlesschrome|\bcurl\/|\bwget\//i;
const IOS = /\b(iPhone|iPad|iPod)\b|FBIOS|\bCPU (iPhone )?OS \d/i;
const ANDROID = /\bAndroid\b/i;
const WINDOWS_PHONE = /Windows Phone|IEMobile/i;
const DESKTOP = /Windows NT|Macintosh|Mac OS X|X11|CrOS|Linux x86_64|Ubuntu|Fedora/i;

export function detectPlatform(userAgent: string | undefined | null): Detection {
  const ua = typeof userAgent === "string" ? userAgent.slice(0, 512) : "";
  if (!ua.trim()) return { platform: "other", isBot: false };
  if (BOT.test(ua)) return { platform: "other", isBot: true };
  if (WINDOWS_PHONE.test(ua)) return { platform: "other", isBot: false };
  if (IOS.test(ua)) return { platform: "ios", isBot: false };
  if (ANDROID.test(ua)) return { platform: "android", isBot: false };
  if (DESKTOP.test(ua)) return { platform: "desktop", isBot: false };
  return { platform: "other", isBot: false };
}

const LABEL = /^[a-z0-9_-]{1,32}$/;

/** Whitelist a src/campaign label. Lower-cases first so "IG" == "ig". */
export function sanitizeLabel(raw: unknown, fallback: string): string {
  // Express may hand us arrays for repeated params (?src=a&src=b): reject.
  if (typeof raw !== "string") return fallback;
  const value = raw.trim().toLowerCase();
  return LABEL.test(value) ? value : fallback;
}
