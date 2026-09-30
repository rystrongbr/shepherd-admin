type Tier = "free" | "plus" | "enterprise";
export type TierRow = {
  tier: string;
  subscription_product_id: string | null;
  subscription_expires_at: string | null;
};

/** Read-only authorization check. Manual reviewer grants without IAP remain intact. */
export function effectiveTier(row: TierRow, now = Date.now()): Tier {
  if (row.tier !== "plus" && row.tier !== "enterprise") return "free";
  if (!row.subscription_product_id) return row.tier;
  const expiry = row.subscription_expires_at ? Date.parse(row.subscription_expires_at) : NaN;
  return Number.isFinite(expiry) && expiry > now ? row.tier : "free";
}
