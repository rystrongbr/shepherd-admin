/**
 * Marketing-site traffic module — refresh + cron registration.
 *
 * Owns the background job that keeps the Overview "Unique Users" tile current
 * by pulling the trailing-30-day unique visitor count from Cloudflare and
 * writing a snapshot row. See ./cloudflare.ts for the API details and the
 * failure philosophy (never write a fake number, never present stale as
 * fresh).
 */

import * as cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { storage } from "../storage";
import {
  fetchCloudflareUniques30d,
  getCloudflareConfig,
  CLOUDFLARE_SOURCE,
  UNIQUES_30D_METRIC,
} from "./cloudflare";

// Daily at 07:23 UTC. Off the :00 mark on purpose; the exact minute does not
// matter for a once-a-day marketing metric. Overridable via env for testing.
const DEFAULT_CRON = "23 7 * * *";

let started = false;
let task: ScheduledTask | null = null;

export interface RefreshResult {
  ran: boolean;
  reason?: string;
  value?: number;
}

/**
 * Fetch the latest Cloudflare 30-day uniques and, on success, insert a
 * snapshot row. Returns { ran:false, reason } when credentials are missing or
 * the fetch failed — callers should NOT treat that as an error worth throwing,
 * it just means the tile keeps showing its previous (flagged-stale) value.
 */
export async function refreshCloudflareTraffic(): Promise<RefreshResult> {
  if (!getCloudflareConfig()) {
    return { ran: false, reason: "cloudflare_credentials_missing" };
  }

  const value = await fetchCloudflareUniques30d();
  if (value == null) {
    return { ran: false, reason: "cloudflare_fetch_failed" };
  }

  storage.createTrafficSnapshot({
    source: CLOUDFLARE_SOURCE,
    metric: UNIQUES_30D_METRIC,
    value,
    recordedAt: new Date().toISOString(),
    note: "auto: cloudflare graphql httpRequests1dGroups uniq.uniques (30d)",
  });

  return { ran: true, value };
}

/**
 * Register the daily traffic-refresh cron. Always registered; the handler is a
 * no-op when Cloudflare credentials are absent, so the job is safe to run in
 * every environment. Also fires one refresh shortly after boot so a freshly
 * deployed service does not have to wait until the next scheduled tick.
 */
export function startTrafficCron(): void {
  if (started) {
    console.warn("[traffic] cron start called twice; ignoring");
    return;
  }
  started = true;

  const schedule = (process.env.CLOUDFLARE_TRAFFIC_CRON ?? DEFAULT_CRON).trim();
  if (!cron.validate(schedule)) {
    console.error(`[traffic] invalid cron schedule "${schedule}"; not registered`);
    return;
  }

  task = cron.schedule(schedule, async () => {
    const result = await refreshCloudflareTraffic();
    if (result.ran) {
      console.log(`[traffic] cloudflare uniques_30d refreshed: ${result.value}`);
    } else {
      console.warn(`[traffic] cloudflare refresh skipped: ${result.reason}`);
    }
  });

  console.log(
    `[traffic] cron registered (${schedule}); credentials ${getCloudflareConfig() ? "present" : "MISSING"}`,
  );

  // Kick off an initial refresh in the background (best-effort; never blocks
  // boot and never throws out of here).
  void refreshCloudflareTraffic()
    .then((result) => {
      if (result.ran) {
        console.log(`[traffic] initial cloudflare refresh: ${result.value}`);
      } else {
        console.warn(`[traffic] initial cloudflare refresh skipped: ${result.reason}`);
      }
    })
    .catch((err) => {
      console.error(
        `[traffic] initial cloudflare refresh error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}

/** Stop the traffic cron (tests / graceful shutdown). */
export function stopTrafficCron(): void {
  if (task) {
    try {
      task.stop();
    } catch {
      /* noop */
    }
    task = null;
  }
  started = false;
}
