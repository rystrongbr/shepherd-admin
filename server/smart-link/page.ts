import { APP_STORE_BADGE, GOOGLE_PLAY_BADGE } from "./badges";
import { DESKTOP_QR_SVG } from "./qr";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

/**
 * Fallback page for desktop / unknown / bot traffic. Self-contained (inline
 * CSS, inline badges, ~1 KB of inline JS) and palette-matched to
 * my-shepherd-app/style.css. All dynamic values are whitelisted labels that
 * are additionally HTML-escaped and JSON-encoded.
 */
export function renderFallbackPage(urls: { appStore: string; googlePlay: string }): string {
  const appStore = escapeHtml(urls.appStore);
  const googlePlay = escapeHtml(urls.googlePlay);
  // JSON.stringify + "<" escaping keeps the values inert inside <script>.
  const js = (v: string) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Get My Shepherd — Scripture for your everyday life</title>
<meta name="description" content="Download My Shepherd for iPhone and Android. Scripture for your everyday life.">
<meta name="robots" content="noindex, follow">
<meta name="theme-color" content="#F6F0E2">
<meta property="og:type" content="website">
<meta property="og:site_name" content="My Shepherd">
<meta property="og:title" content="My Shepherd — Scripture for your everyday life">
<meta property="og:description" content="Download My Shepherd for iPhone and Android.">
<meta property="og:url" content="https://app.myshepherdapp.church/get">
<meta property="og:image" content="https://app.myshepherdapp.church/og-image.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<script>
(function () {
  // iPadOS 13+ Safari reports a desktop "Macintosh" UA, so the server can't
  // tell it from a Mac. Touch support can: real Macs report 0 touch points.
  try {
    var ua = navigator.userAgent || "";
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) {
      window.location.replace(${js(urls.appStore)});
    }
  } catch (e) { /* stay on the page; the buttons below still work */ }
})();
</script>
<style>
:root { --brown:#7B4A1E; --brown-dark:#5A3415; --gold:#C8852A; --cream:#F6F0E2; --cream-card:#FFFCF3; --text-mid:#5A4A3A; --border:#E6D8C4; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { min-height: 100%; }
body { background: var(--cream); color: var(--text-mid); font: 400 1rem/1.6 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; padding: 24px 16px; min-height: 100vh; min-height: 100dvh; }
main { width: 100%; max-width: 440px; background: var(--cream-card); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.10); padding: 40px 28px 32px; text-align: center; }
.logo { display: inline-flex; align-items: center; gap: 10px; color: var(--brown); }
h1 { font: 600 1.75rem/1.25 'Lora', Georgia, serif; color: var(--brown-dark); }
.tagline { margin: 12px 0 28px; font-size: 1.0625rem; }
.badges { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.badges a { display: inline-block; border-radius: 10px; line-height: 0; }
.badges a:focus-visible { outline: 3px solid var(--brown); outline-offset: 4px; }
.badges img { display: block; height: 56px; width: auto; }
.badges .gp img { height: 81px; margin: -12.5px 0; } /* Google's PNG has built-in padding */
.qr-wrap { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--border); display: none; }
.qr { display: block; margin: 0 auto; border: 1px solid var(--border); border-radius: 8px; }
.qr-label { margin-top: 10px; font-size: .875rem; color: var(--text-mid); }
@media (hover: hover) and (pointer: fine) { .qr-wrap { display: block; } }
.note { margin-top: 24px; font-size: .8125rem; color: var(--text-mid); }
.note a { color: var(--brown-dark); }
@media (min-width: 520px) { .badges { flex-direction: row; justify-content: center; } }
</style>
</head>
<body>
<main>
  <div class="logo" aria-hidden="true">
    <svg width="44" height="44" viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="13" stroke="#7B4A1E" stroke-width="2"/>
      <path d="M14 6 L14 22 M9 10 C9 10 11 8 14 10 C17 8 19 10 19 10" stroke="#7B4A1E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>
  <h1>My Shepherd</h1>
  <p class="tagline">Scripture for your everyday life</p>
  <div class="badges">
    <a class="as" href="${appStore}" rel="noopener"><img src="${APP_STORE_BADGE}" alt="Download on the App Store" width="168" height="56"></a>
    <a class="gp" href="${googlePlay}" rel="noopener"><img src="${GOOGLE_PLAY_BADGE}" alt="Get it on Google Play" width="209" height="81"></a>
  </div>
  <div class="qr-wrap">
    ${DESKTOP_QR_SVG}
    <p class="qr-label">On a computer? Scan with your phone's camera.</p>
  </div>
  <p class="note">Free on iPhone, iPad and Android. <a href="https://myshepherdapp.church/">Learn more at myshepherdapp.church</a></p>
</main>
</body>
</html>`;
}
