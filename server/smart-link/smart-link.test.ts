import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import express from "express";
import Database from "better-sqlite3";

process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "smart-link-isolated-test-secret-not-production";
process.env.OPENAI_API_KEY = "test-only-never-used";

import { detectPlatform, sanitizeLabel } from "./detect";
import { registerSmartLink, APP_STORE_URL, GOOGLE_PLAY_URL, googlePlayUrl } from "./routes";
import { createSmartLinkStore, type SmartLinkClick } from "./store";
import { computeMarketingMetrics } from "../metrics/marketing";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  ipod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  ipadosDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  instagramIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.32.97 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 634839193)",
  instagramAndroid: "Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Instagram 350.0.0.42.89 Android (33/13; 480dpi; 1080x2340; samsung; SM-S911B; dm1q; qcom; en_US; 645138234)",
  facebookIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0.0.36.106;FBBV/600000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]",
  facebookAndroid: "Mozilla/5.0 (Linux; Android 12; SM-G991B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/447.0.0.40.110;]",
  tiktokAndroid: "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36 trill_2023106030 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/31.6.3 ByteLocale/en ByteFullLocale/en Region/US BytedanceWebview/d8a21c6",
  tiktokIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_32.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US",
  threadsIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 340.0.0.22.109 (iPhone14,7; iOS 17_5; en_US)",
  pinterestIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]",
  desktopChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  googlebotSmartphone: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.69 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  facebookPreview: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  twitterbot: "Twitterbot/1.0",
};

test("detectPlatform buckets real-world UAs, incl. in-app webviews and crawlers", () => {
  const expect: Record<keyof typeof UA, [string, boolean]> = {
    iphone: ["ios", false], ipad: ["ios", false], ipod: ["ios", false],
    ipadosDesktop: ["desktop", false],
    android: ["android", false],
    instagramIos: ["ios", false], instagramAndroid: ["android", false],
    facebookIos: ["ios", false], facebookAndroid: ["android", false],
    tiktokAndroid: ["android", false], tiktokIos: ["ios", false],
    threadsIos: ["ios", false], pinterestIos: ["ios", false],
    desktopChrome: ["desktop", false], macChrome: ["desktop", false], linuxFirefox: ["desktop", false],
    googlebot: ["other", true], googlebotSmartphone: ["other", true],
    facebookPreview: ["other", true], twitterbot: ["other", true],
  };
  for (const [key, [platform, isBot]] of Object.entries(expect)) {
    assert.deepEqual(detectPlatform(UA[key as keyof typeof UA]), { platform, isBot }, key);
  }
  assert.deepEqual(detectPlatform(""), { platform: "other", isBot: false });
  assert.deepEqual(detectPlatform(undefined), { platform: "other", isBot: false });
  assert.deepEqual(detectPlatform("SomethingWeird/1.0"), { platform: "other", isBot: false });
});

test("sanitizeLabel whitelists [a-z0-9_-]{1,32}", () => {
  assert.equal(sanitizeLabel("tiktok", "unknown"), "tiktok");
  assert.equal(sanitizeLabel("IG_Brand", "unknown"), "ig_brand");
  assert.equal(sanitizeLabel("podcast-ep-12", "unknown"), "podcast-ep-12");
  assert.equal(sanitizeLabel("a".repeat(32), "unknown"), "a".repeat(32));
  for (const bad of ["", " ", "a".repeat(33), "<script>", "ig brand", "fb.com", "x%00", "é", "a&b=c", "../etc"]) {
    assert.equal(sanitizeLabel(bad, "unknown"), "unknown", JSON.stringify(bad));
  }
  assert.equal(sanitizeLabel(["ig", "fb"], "unknown"), "unknown");
  assert.equal(sanitizeLabel(undefined, ""), "");
  assert.equal(sanitizeLabel({ a: 1 }, ""), "");
});

type Started = { server: Server; base: string; clicks: SmartLinkClick[] };
async function start(record?: (c: SmartLinkClick) => void, env: NodeJS.ProcessEnv = {}): Promise<Started> {
  const clicks: SmartLinkClick[] = [];
  const app = express();
  registerSmartLink(app, { record: record ?? (c => { clicks.push(c); }), env, defer: fn => fn() });
  // Simulates the production SPA catch-all registered after routes.
  app.use((_req, res) => { res.status(200).send("SPA"); });
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, clicks };
}
const stop = (s: Server) => new Promise<void>(resolve => { s.close(() => resolve()); s.closeAllConnections(); });
const get = (url: string, ua?: string, method = "GET") =>
  fetch(url, { method, redirect: "manual", headers: ua === undefined ? {} : { "user-agent": ua } });

test("GET /get and /download route by device with no-store", async () => {
  const { server, base, clicks } = await start();
  try {
    for (const path of ["/get", "/get/", "/download", "/download/"]) {
      for (const ua of [UA.iphone, UA.ipad, UA.instagramIos, UA.facebookIos, UA.tiktokIos]) {
        const res = await get(`${base}${path}?src=ig`, ua);
        assert.equal(res.status, 302, `${path} ios`);
        assert.equal(res.headers.get("location"), APP_STORE_URL);
        assert.equal(res.headers.get("cache-control"), "no-store");
      }
      for (const ua of [UA.android, UA.tiktokAndroid, UA.instagramAndroid, UA.facebookAndroid]) {
        const res = await get(`${base}${path}?src=tiktok&campaign=launch`, ua);
        assert.equal(res.status, 302, `${path} android`);
        assert.equal(res.headers.get("location"),
          `${GOOGLE_PLAY_URL}&referrer=utm_source%3Dtiktok%26utm_medium%3Dsmartlink%26utm_campaign%3Dlaunch`);
        assert.equal(res.headers.get("cache-control"), "no-store");
      }
      for (const ua of [UA.desktopChrome, UA.ipadosDesktop, UA.googlebot, UA.googlebotSmartphone, UA.facebookPreview, "", undefined]) {
        const res = await get(`${base}${path}?src=qr`, ua);
        assert.equal(res.status, 200, `${path} fallback ${ua}`);
        assert.match(res.headers.get("content-type") ?? "", /text\/html/);
        assert.equal(res.headers.get("cache-control"), "no-store");
        const html = await res.text();
        assert.ok(html.includes("My Shepherd"));
        assert.ok(html.includes("Scripture for your everyday life"));
        assert.ok(html.includes(`href="${APP_STORE_URL}"`));
        assert.ok(html.includes(`href="${GOOGLE_PLAY_URL}&amp;referrer=utm_source%3Dqr%26utm_medium%3Dsmartlink"`));
        assert.ok(html.includes("maxTouchPoints"), "iPadOS client-side redirect present");
        assert.ok(html.includes('alt="Download on the App Store"') && html.includes('alt="Get it on Google Play"'));
      }
    }
    // Unrelated paths fall through untouched.
    for (const path of ["/getx", "/get/more", "/downloads", "/api/get"]) {
      const res = await get(`${base}${path}`, UA.iphone);
      assert.equal(res.status, 200, path);
      assert.equal(await res.text(), "SPA");
    }
    assert.ok(clicks.length > 0);
    assert.ok(clicks.every(c => Object.keys(c).sort().join() === "campaign,platform,src"), "only PII-free fields");
  } finally { await stop(server); }
});

test("src/campaign sanitization flows to redirect and log; HEAD is not logged", async () => {
  const { server, base, clicks } = await start();
  try {
    let res = await get(`${base}/get?src=%3Cscript%3E&campaign=a%20b`, UA.android);
    assert.equal(res.headers.get("location"), `${GOOGLE_PLAY_URL}&referrer=utm_source%3Dunknown%26utm_medium%3Dsmartlink`);
    assert.deepEqual(clicks.pop(), { src: "unknown", campaign: "", platform: "android" });
    res = await get(`${base}/get?src=IG_Brand&campaign=Ep01`, UA.iphone);
    assert.deepEqual(clicks.pop(), { src: "ig_brand", campaign: "ep01", platform: "ios" });
    res = await get(`${base}/get?src=a&src=b`, UA.desktopChrome);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes("<script>alert"));
    assert.deepEqual(clicks.pop(), { src: "unknown", campaign: "", platform: "desktop" });
    res = await get(`${base}/get`, UA.googlebot);
    assert.deepEqual(clicks.pop(), { src: "unknown", campaign: "", platform: "other" });
    const before = clicks.length;
    res = await get(`${base}/get?src=ig`, UA.iphone, "HEAD");
    assert.equal(res.status, 302);
    assert.equal(clicks.length, before);
  } finally { await stop(server); }
});

test("a throwing logger never breaks the redirect; kill switch disables logging", async () => {
  const errors = console.error;
  console.error = () => {};
  const { server, base } = await start(() => { throw new Error("SQLITE_BUSY: database is locked"); });
  try {
    const ios = await get(`${base}/get?src=fb`, UA.iphone);
    assert.equal(ios.status, 302);
    assert.equal(ios.headers.get("location"), APP_STORE_URL);
    const android = await get(`${base}/get?src=fb`, UA.android);
    assert.equal(android.status, 302);
    const desktop = await get(`${base}/get?src=fb`, UA.desktopChrome);
    assert.equal(desktop.status, 200);
  } finally { await stop(server); console.error = errors; }

  // Real store on a closed DB, with the production (setImmediate) defer.
  const db = new Database(":memory:");
  const store = createSmartLinkStore(db);
  db.close();
  const app = express();
  registerSmartLink(app, { record: c => store.record(c) });
  const s2 = createServer(app); s2.listen(0, "127.0.0.1"); await once(s2, "listening");
  console.error = () => {};
  try {
    const res = await get(`http://127.0.0.1:${(s2.address() as { port: number }).port}/download?src=email`, UA.iphone);
    assert.equal(res.status, 302);
    await new Promise(r => setImmediate(r));
  } finally { await stop(s2); console.error = errors; }

  const off = await start(undefined, { SMART_LINK_LOGGING_ENABLED: "false" });
  try {
    assert.equal((await get(`${off.base}/get?src=ig`, UA.iphone)).status, 302);
    assert.equal(off.clicks.length, 0);
  } finally { await stop(off.server); }
});

test("per-IP limiter only throttles logging, never the redirect", async () => {
  const { server, base, clicks } = await start();
  try {
    for (let i = 0; i < 130; i++) {
      const res = await get(`${base}/get?src=podcast`, UA.iphone);
      assert.equal(res.status, 302);
      await res.arrayBuffer();
    }
    assert.equal(clicks.length, 120);
  } finally { await stop(server); }
});

test("googlePlayUrl encodes a single referrer param", () => {
  assert.equal(googlePlayUrl("youtube", ""),
    "https://play.google.com/store/apps/details?id=church.myshepherdapp&referrer=utm_source%3Dyoutube%26utm_medium%3Dsmartlink");
});

test("store persists PII-free rows and marketing metrics report smart link clicks", () => {
  const db = new Database(":memory:");
  const store = createSmartLinkStore(db);
  store.record({ src: "podcast", campaign: "ep1", platform: "ios" });
  store.record({ src: "podcast", campaign: "ep1", platform: "android" });
  store.record({ src: "podcast", campaign: "", platform: "ios" });
  store.record({ src: "tiktok", campaign: "", platform: "android" });
  store.record({ src: "unknown", campaign: "", platform: "desktop" });
  store.record({ src: "qr", campaign: "", platform: "other" });
  const cols = (db.prepare(`SELECT name FROM pragma_table_info('smart_link_clicks')`).all() as { name: string }[]).map(r => r.name);
  assert.deepEqual(cols, ["id", "created_at", "src", "campaign", "platform"]);
  // An old row outside a 7-day window.
  db.prepare(`INSERT INTO smart_link_clicks (created_at, src, campaign, platform) VALUES (?, 'ig', '', 'ios')`)
    .run("2020-01-01T00:00:00.000Z");

  const now = new Date();
  const m = computeMarketingMetrics(db, { days: 7, includeInternal: false, now });
  const s = m.attribution.smartLinkClicks;
  assert.equal(s.available, true);
  assert.equal(s.totalAllTime, 7);
  assert.equal(s.clicksInWindow, 6);
  assert.deepEqual(s.byPlatform, { ios: 2, android: 2, desktop: 1, other: 1 });
  assert.deepEqual(s.bySource, { podcast: 3, tiktok: 1, unknown: 1, qr: 1 });
  assert.deepEqual(s.byCampaign, { "(none)": 4, ep1: 2 });
  assert.deepEqual(s.bySourceAndPlatform.podcast, { ios: 2, android: 1, desktop: 0, other: 0 });
  assert.equal(s.daily.length, 7);
  const today = now.toISOString().slice(0, 10);
  assert.deepEqual(s.daily.at(-1), { date: today, total: 6, ios: 2, android: 2, desktop: 1, other: 1 });
  assert.equal(m.daily.at(-1)!.smartLinkClicks, 6);
  assert.equal(m.windowTotals.smartLinkClicks, 6);
  assert.ok(m.definitions.smartLinkClicks);

  // Missing table → zeros, not an error.
  const empty = computeMarketingMetrics(new Database(":memory:"), { days: 3, includeInternal: false, now });
  assert.equal(empty.attribution.smartLinkClicks.available, false);
  assert.equal(empty.windowTotals.smartLinkClicks, 0);
  assert.equal(empty.attribution.smartLinkClicks.daily.length, 3);
});

test("real routing: /get is public, not behind the /api gate, and the gate still protects /api", async () => {
  const { registerRoutes } = await import("../routes");
  const { sqlite } = await import("../storage");
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  app.use((_req, res) => { res.status(200).send("SPA"); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const ios = await get(`${base}/get?src=podcast`, UA.iphone);
    assert.equal(ios.status, 302);
    assert.equal(ios.headers.get("location"), APP_STORE_URL);
    const desktop = await get(`${base}/download?src=email`, UA.desktopChrome);
    assert.equal(desktop.status, 200);
    assert.ok((await desktop.text()).includes("Scripture for your everyday life"));
    assert.equal((await fetch(`${base}/api/user/me`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/metrics/marketing`)).status, 401);
    await new Promise(r => setImmediate(r));
    const rows = sqlite.prepare(`SELECT src, campaign, platform FROM smart_link_clicks ORDER BY id`).all();
    assert.deepEqual(rows, [
      { src: "podcast", campaign: "", platform: "ios" },
      { src: "email", campaign: "", platform: "desktop" },
    ]);
  } finally { await stop(server); }
});

test("desktop fallback page offers QR + marketing site, not the consumer web app", async () => {
  const { renderFallbackPage } = await import("./page");
  const { DESKTOP_QR_TARGET } = await import("./qr");
  const html = renderFallbackPage({ appStore: APP_STORE_URL, googlePlay: GOOGLE_PLAY_URL });
  assert.ok(html.includes('class="qr"'), "QR code is rendered");
  assert.ok(html.includes("https://myshepherdapp.church/"), "links to the marketing site");
  assert.ok(!html.includes('href="https://app.myshepherdapp.church/"'), "no link to the consumer web app");
  assert.equal(sanitizeLabel(new URL(DESKTOP_QR_TARGET).searchParams.get("src") ?? "", "unknown"), "qr_desktop");
});
