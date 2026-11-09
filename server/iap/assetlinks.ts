/**
 * Android App Links: /.well-known/assetlinks.json lets Android open
 * app.myshepherdapp.church/verify links directly in the app (magic-link
 * sign-in) instead of asking the user to pick a browser.
 *
 * GOOGLE_PLAY_SHA256_FINGERPRINTS: comma-separated SHA-256 certificate
 * fingerprints (Play Console → Test and release → App integrity → App signing
 * key certificate). Not secret. When unset the route returns 404 as today.
 */
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function buildAssetLinks(env: NodeJS.ProcessEnv = process.env) {
  const fingerprints = (env.GOOGLE_PLAY_SHA256_FINGERPRINTS ?? "")
    .split(",")
    .map(value => value.trim().toUpperCase())
    .filter(value => FINGERPRINT.test(value));
  if (!fingerprints.length) return null;
  return [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || "church.myshepherdapp",
      sha256_cert_fingerprints: fingerprints,
    },
  }];
}
