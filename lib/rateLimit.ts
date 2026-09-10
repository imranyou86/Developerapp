import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Cost/abuse guard for the paid AI routes (app/api/claude/*, app/api/gemini/*,
// and the house-book PDF's AI closing note) — nothing capped how many times
// a signed-in user could call an expensive route (image generation,
// web-search-grounded estimates), so a buggy client or a malicious user
// could otherwise run up real API bills with no limit. Backed by a table
// (api_rate_limit_hits, migration 036) rather than in-memory state, since
// serverless route handlers don't reliably share memory across instances.
//
// Written via the service-role admin client, same reasoning as
// lib/alerts.ts's dispatch — this is app-internal bookkeeping, not
// something a user's own session should read or write, even for their own
// rows.

export const RATE_LIMITS: Record<string, { limit: number; windowSeconds: number }> = {
  "estimate-construction-cost": { limit: 15, windowSeconds: 3600 },
  "evaluate-deal": { limit: 15, windowSeconds: 3600 },
  "evaluate-bid": { limit: 20, windowSeconds: 3600 },
  "extract-bid": { limit: 20, windowSeconds: 3600 },
  "extract-inspection-report": { limit: 20, windowSeconds: 3600 },
  "find-product": { limit: 30, windowSeconds: 3600 },
  "identify-finishes": { limit: 30, windowSeconds: 3600 },
  "lookup-listing": { limit: 20, windowSeconds: 3600 },
  "lookup-property-details": { limit: 20, windowSeconds: 3600 },
  "lookup-zoning-coverage": { limit: 20, windowSeconds: 3600 },
  "detect-rooms": { limit: 20, windowSeconds: 3600 },
  "room-concept": { limit: 30, windowSeconds: 3600 },
  "suggest-room-layout": { limit: 30, windowSeconds: 3600 },
  "house-book": { limit: 10, windowSeconds: 3600 },
  "generate-room-image": { limit: 15, windowSeconds: 3600 },
  "edit-room-image": { limit: 15, windowSeconds: 3600 },
};

async function checkRateLimit(
  userId: string,
  route: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number }
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const admin = createAdminClient();
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const { count, error } = await admin
    .from("api_rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("route", route)
    .gte("created_at", windowStart);

  // Fail open on a DB error — an outage in the rate limiter itself
  // shouldn't take down the feature it's protecting.
  if (error) {
    console.error(`Rate limit check failed for "${route}":`, error.message);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if ((count ?? 0) >= limit) {
    return { allowed: false, retryAfterSeconds: windowSeconds };
  }

  await admin.from("api_rate_limit_hits").insert({ user_id: userId, route });
  // Best-effort cleanup so the table doesn't grow unbounded — cheap enough
  // to piggyback on a normal request rather than needing its own scheduled
  // job. Never awaited-for-correctness (a missed cleanup just means a
  // slightly bigger table, not a wrong rate-limit decision).
  admin
    .from("api_rate_limit_hits")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .then(() => {});

  return { allowed: true, retryAfterSeconds: 0 };
}

// Drop-in guard for a route handler: call right after the auth.getUser()
// check, and return the response immediately if this comes back non-null.
//   const limited = await enforceRateLimit(user.id, "estimate-construction-cost");
//   if (limited) return limited;
export async function enforceRateLimit(userId: string, route: keyof typeof RATE_LIMITS): Promise<NextResponse | null> {
  const config = RATE_LIMITS[route];
  const result = await checkRateLimit(userId, route, config);
  if (result.allowed) return null;

  return NextResponse.json(
    { error: "You've reached the hourly limit for this feature. Try again in a bit." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}
