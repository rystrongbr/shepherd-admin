// Demo Reset
// ──────────────────────────────────────────────────────────────────────────────
// Wipes all rows from all tables, then re-runs the demo seed.
// Gated by ALLOW_DEMO_RESET=true at the route layer in routes.ts.
// Used by the demo environment so a fresh sales call always starts from a
// known baseline. NEVER deployed in production (production never sets the env).
//
// Note: this depends on the seed function exported from storage.ts. Keep them
// in sync — if storage.ts seed adds new tables, add the corresponding DELETE
// statement here.

import { db, runDemoSeed } from "./storage.js";
import {
  churches, members, campaigns, sequences, activities, insights,
  affiliations, appUsers, chats, bibleTopicContent,
  sequenceEnrollments, emailEvents,
} from "@shared/schema";

export function resetDemoData(): {
  wiped: Record<string, number>;
  seeded: { churches: number; members: number; campaigns: number; sequences: number; activities: number; insights: number };
} {
  console.log("[demoReset] Wiping all demo data...");

  // Order matters only if there are FKs with ON DELETE RESTRICT — we don't
  // have any, so order is informational. Tables wiped in dependency order anyway.
  const wiped: Record<string, number> = {};
  const tablesInOrder = [
    { name: "email_events",          table: emailEvents },
    { name: "sequence_enrollments",  table: sequenceEnrollments },
    { name: "chats",                 table: chats },
    { name: "insights",              table: insights },
    { name: "activities",            table: activities },
    { name: "campaigns",             table: campaigns },
    { name: "sequences",             table: sequences },
    { name: "members",               table: members },
    { name: "affiliations",          table: affiliations },
    { name: "app_users",             table: appUsers },
    { name: "bible_topic_content",   table: bibleTopicContent },
    { name: "churches",              table: churches },
  ];

  for (const { name, table } of tablesInOrder) {
    const result = db.delete(table).run();
    wiped[name] = result.changes;
  }

  console.log("[demoReset] Wiped:", wiped);
  console.log("[demoReset] Re-running seed...");
  const seedResult = runDemoSeed();
  console.log("[demoReset] Seed complete.");

  return { wiped, seeded: seedResult.inserted };
}
