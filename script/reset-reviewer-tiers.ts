/**
 * One-off admin script to prepare the App Store reviewer accounts.
 *
 * Sets:
 *   - apple-review@myshepherdapp.church        → enterprise (full paid access)
 *   - apple-review+free@myshepherdapp.church   → free       (paywall visible)
 *
 * Both accounts share the same Gmail inbox via +alias, but the backend
 * treats them as two distinct user rows. This script does not touch any
 * other user.
 *
 * Idempotent: safe to run multiple times. Prints a before/after summary
 * so you can visually confirm the change stuck.
 *
 * Run from shepherd-admin repo root:
 *   npx tsx script/reset-reviewer-tiers.ts
 *
 * On Railway, the same command works — DB_PATH is read from the process
 * environment automatically, so the running container touches the same
 * SQLite volume the app uses.
 */

import { sql } from "drizzle-orm";
import { db } from "../server/storage";
import { appUsers } from "../shared/schema";
import { eq } from "drizzle-orm";

const REVIEWER_ENTERPRISE = "apple-review@myshepherdapp.church";
const REVIEWER_FREE = "apple-review+free@myshepherdapp.church";

type Row = {
  id: number;
  email: string;
  tier: string;
  subscriptionProductId: string | null;
  subscriptionExpiresAt: string | null;
} | undefined;

function fetch(email: string): Row {
  return db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      tier: appUsers.tier,
      subscriptionProductId: appUsers.subscriptionProductId,
      subscriptionExpiresAt: appUsers.subscriptionExpiresAt,
    })
    .from(appUsers)
    .where(eq(appUsers.email, email.toLowerCase()))
    .get() as Row;
}

function printRow(label: string, row: Row): void {
  if (!row) {
    console.log(`  ${label}:  <not found in DB>`);
    return;
  }
  console.log(
    `  ${label}:  id=${row.id}  tier=${row.tier}  productId=${row.subscriptionProductId ?? "null"}  expiresAt=${row.subscriptionExpiresAt ?? "null"}`,
  );
}

function setTier(email: string, targetTier: "free" | "enterprise"): void {
  const now = new Date().toISOString();

  if (targetTier === "free") {
    db.update(appUsers)
      .set({
        tier: "free",
        subscriptionProductId: null,
        subscriptionOriginalTxnId: null,
        subscriptionExpiresAt: null,
        subscriptionUpdatedAt: now,
      })
      .where(eq(appUsers.email, email.toLowerCase()))
      .run();
  } else {
    // Enterprise reviewer: grant the tier but leave subscription fields
    // NULL so we don't create a fake StoreKit transaction. The tier
    // column alone drives entitlement lookups.
    db.update(appUsers)
      .set({
        tier: "enterprise",
        subscriptionProductId: null,
        subscriptionOriginalTxnId: null,
        subscriptionExpiresAt: null,
        subscriptionUpdatedAt: now,
      })
      .where(eq(appUsers.email, email.toLowerCase()))
      .run();
  }
}

console.log("=".repeat(70));
console.log("Reviewer-account tier reset");
console.log("=".repeat(70));

console.log("\nBEFORE:");
printRow("Enterprise reviewer", fetch(REVIEWER_ENTERPRISE));
printRow("Free-tier reviewer ", fetch(REVIEWER_FREE));

const enterpriseRow = fetch(REVIEWER_ENTERPRISE);
const freeRow = fetch(REVIEWER_FREE);

if (!enterpriseRow) {
  console.warn(
    `\nWARN: ${REVIEWER_ENTERPRISE} not in DB. Sign in once from the app first, then re-run this script.`,
  );
}
if (!freeRow) {
  console.warn(
    `\nWARN: ${REVIEWER_FREE} not in DB. Sign in once from the app first, then re-run this script.`,
  );
}

if (enterpriseRow) setTier(REVIEWER_ENTERPRISE, "enterprise");
if (freeRow) setTier(REVIEWER_FREE, "free");

console.log("\nAFTER:");
printRow("Enterprise reviewer", fetch(REVIEWER_ENTERPRISE));
printRow("Free-tier reviewer ", fetch(REVIEWER_FREE));

console.log("\nDone. Both reviewer accounts are now set to the correct tier.");
console.log("=".repeat(70));

process.exit(0);
