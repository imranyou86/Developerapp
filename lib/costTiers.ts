import type { CostTier } from "@/lib/types";

// Shared by the server route (to instruct/clamp Claude's output) and the
// client (to let the user manually swap tiers and see a deterministic total
// for total_sqft without another API call). Keep these two definitions in
// sync — there's intentionally only one.
export const COST_TIER_BANDS: Record<CostTier, { low: number; high: number }> = {
  low: { low: 250, high: 300 },
  mid: { low: 350, high: 400 },
  high: { low: 450, high: 550 },
};

export const COST_TIER_LABEL: Record<CostTier, string> = {
  low: "Low tier · $250–300/sqft",
  mid: "Mid tier · $350–400/sqft",
  high: "High tier · $450+/sqft",
};
