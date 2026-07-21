/**
 * Marketing-site traffic — Cloudflare GraphQL Analytics integration.
 *
 * The Overview "Unique Users" tile reads the newest row in `traffic_snapshots`
 * for (source=cloudflare, metric=uniques_30d). Historically that row was only
 * ever written by a human pasting a number into chat, so the tile went stale
 * the moment nobody pasted. This module makes the number self-refreshing: it
 * queries Cloudflare's GraphQL Analytics API for the trailing-30-day unique
 * visitor count and inserts a snapshot. A daily cron (see ./cron.ts) calls
 * refreshCloudflareTraffic() so the tile stays current with no manual step.
 *
 * Config (env vars, read live from process.env so a Railway change takes
 * effect on the next tick without a redeploy):
 *   - CLOUDFLARE_API_TOKEN  — API token with Zone → Analytics → Read on the
 *                             myshepherdapp.church zone.
 *   - CLOUDFLARE_ZONE_ID    — the zone tag for myshepherdapp.church.
 *
 * Failure philosophy: if credentials are missing or the API call fails, we log
 * loudly and DO NOT write a snapshot. A missing fetch must never overwrite a
 * good number with a fake one, and it must never silently present stale data
 * as fresh — the UI flags staleness on its own (see OverviewPage).
 */

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

export const CLOUDFLARE_SOURCE = "cloudflare";
export const UNIQUES_30D_METRIC = "uniques_30d";

export interface CloudflareTrafficConfig {
  apiToken: string;
  zoneId: string;
}

/** Live-read the Cloudflare credentials from the environment. */
export function getCloudflareConfig(): CloudflareTrafficConfig | null {
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN ?? "").trim();
  const zoneId = (process.env.CLOUDFLARE_ZONE_ID ?? "").trim();
  if (!apiToken || !zoneId) return null;
  return { apiToken, zoneId };
}

/** YYYY-MM-DD in UTC, `daysAgo` days before now (0 = today). */
function utcDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch the trailing-30-day unique visitor count for the configured zone from
 * Cloudflare's GraphQL Analytics API.
 *
 * Uses the `httpRequests1dGroups` dataset with `uniq.uniques` and no grouping
 * dimension, which returns the de-duplicated unique visitor count aggregated
 * across the whole date window (this matches the "Unique Visitors" figure in
 * the Cloudflare zone Analytics dashboard). We request the last 30 calendar
 * days (date_geq 29-days-ago .. date_leq today).
 *
 * Returns the integer count, or null if credentials are missing or the request
 * fails / returns no data. Never throws.
 */
export async function fetchCloudflareUniques30d(): Promise<number | null> {
  const config = getCloudflareConfig();
  if (!config) {
    console.warn(
      "[traffic] Cloudflare fetch skipped: CLOUDFLARE_API_TOKEN and/or CLOUDFLARE_ZONE_ID not set",
    );
    return null;
  }

  const since = utcDate(29);
  const until = utcDate(0);
  const query = `
    query Uniques30d($zoneTag: String!, $since: Date!, $until: Date!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(
            limit: 1
            filter: { date_geq: $since, date_leq: $until }
          ) {
            uniq { uniques }
          }
        }
      }
    }`;

  try {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({
        query,
        variables: { zoneTag: config.zoneId, since, until },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[traffic] Cloudflare API HTTP ${res.status}: ${text.slice(0, 500)}`,
      );
      return null;
    }

    const json: any = await res.json();
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      console.error(
        `[traffic] Cloudflare GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`,
      );
      return null;
    }

    const groups = json?.data?.viewer?.zones?.[0]?.httpRequests1dGroups;
    const uniques = groups?.[0]?.uniq?.uniques;
    if (typeof uniques !== "number" || !Number.isFinite(uniques)) {
      console.error(
        `[traffic] Cloudflare response missing uniq.uniques: ${JSON.stringify(json?.data).slice(0, 500)}`,
      );
      return null;
    }

    return Math.round(uniques);
  } catch (err) {
    console.error(
      `[traffic] Cloudflare fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
