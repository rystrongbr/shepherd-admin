/**
 * Email module — cron registration (Phase B+).
 *
 * Registers all background jobs the email module owns. The current set:
 *   - segmentation: daily at 03:00 America/Chicago (configurable)
 *
 * Kill-switch design:
 *   - The cron is ALWAYS registered when startEmailCrons() is called.
 *   - The handler short-circuits if emailConfig.automationEnabled is false.
 *   - Flipping EMAIL_AUTOMATION_ENABLED=true at runtime in Railway does NOT
 *     require a redeploy — but the new value is read by emailConfig only at
 *     import time. To pick up env changes without restart, the handler reads
 *     process.env directly as a fallback.
 *
 * Future jobs (Phase C, Phase D) hang off this same module and obey the same
 * kill-switch and dry-run conventions. Keep this file as the single
 * registration point so we always know what crons are live.
 */

import * as cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { emailConfig } from "./config";
import { logger } from "./logger";
import { recalculateSegments } from "./segmentation";

let started = false;
const activeJobs: { name: string; task: ScheduledTask }[] = [];

/**
 * Live-reads the master switch so an env-var flip in Railway can take effect
 * on the next scheduled tick without requiring a redeploy. (The module-level
 * emailConfig is captured once at import.)
 */
function isAutomationEnabled(): boolean {
  const raw = process.env.EMAIL_AUTOMATION_ENABLED ?? String(emailConfig.automationEnabled);
  return raw === "true" || raw === "1" || raw === "yes";
}

export function startEmailCrons(): void {
  if (started) {
    logger.warn("email.cron.start.duplicate_call", {});
    return;
  }
  started = true;

  // ─── Segmentation (daily) ──────────────────────────────────────────────
  const schedule = emailConfig.segmentationCronSchedule;
  const timezone = emailConfig.segmentationCronTz;

  if (!cron.validate(schedule)) {
    logger.error("email.cron.invalid_schedule", { schedule });
    return;
  }

  const task = cron.schedule(
    schedule,
    async () => {
      if (!isAutomationEnabled()) {
        logger.info("email.cron.segmentation.skipped", { reason: "automation_disabled" });
        return;
      }
      const startedAt = Date.now();
      logger.info("email.cron.segmentation.start", { schedule, timezone });
      try {
        const result = await recalculateSegments();
        logger.info("email.cron.segmentation.done", {
          durationMs: Date.now() - startedAt,
          totalMembers: result.totalMembers,
          churches: Object.keys(result.perChurch).length,
          errors: result.errors.length,
        });
      } catch (err) {
        logger.error("email.cron.segmentation.failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    { timezone },
  );

  activeJobs.push({ name: "segmentation", task });
  logger.info("email.cron.registered", {
    name: "segmentation",
    schedule,
    timezone,
    automationEnabled: isAutomationEnabled(),
  });
}

/**
 * Stop all registered email crons. Useful for tests, and for the eventual
 * graceful-shutdown handler that Railway should hook into.
 */
export function stopEmailCrons(): void {
  for (const { name, task } of activeJobs) {
    try {
      task.stop();
      logger.info("email.cron.stopped", { name });
    } catch (err) {
      logger.warn("email.cron.stop.failed", {
        name, error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  activeJobs.length = 0;
  started = false;
}

/**
 * For ops endpoints (e.g. /api/email/status) — what crons are registered now.
 */
export function listEmailCrons(): { name: string; schedule: string; timezone: string }[] {
  // node-cron task objects do not expose their original schedule string;
  // we re-derive from config since we only register one job today.
  if (activeJobs.length === 0) return [];
  return [
    {
      name: "segmentation",
      schedule: emailConfig.segmentationCronSchedule,
      timezone: emailConfig.segmentationCronTz,
    },
  ];
}

/**
 * Run the segmentation job once, on demand. Used by an admin-triggered
 * endpoint for testing (`POST /api/email/segmentation/run`). Honors the
 * automation flag the same way the cron does.
 */
export async function runSegmentationNow(): Promise<{ ran: boolean; reason?: string }> {
  if (!isAutomationEnabled()) {
    return { ran: false, reason: "automation_disabled" };
  }
  await recalculateSegments();
  return { ran: true };
}
