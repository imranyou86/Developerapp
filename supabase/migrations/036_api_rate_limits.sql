-- Cost/abuse guard for the paid AI routes (app/api/claude/*, app/api/openai/*,
-- and the house-book PDF's AI closing note) — nothing capped how many times
-- a signed-in user could call an expensive route (image generation,
-- web-search-grounded estimates), so a buggy client or a malicious user
-- could run up real API bills with no limit. See lib/rateLimit.ts for the
-- per-route limits and the check itself.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-035 applied.

create table if not exists api_rate_limit_hits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  route text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_rate_limit_hits_user_route on api_rate_limit_hits (user_id, route, created_at);

alter table api_rate_limit_hits enable row level security;

-- Deliberately no policies at all — this table is only ever read/written by
-- lib/rateLimit.ts via the service-role admin client (same reasoning as
-- lib/alerts.ts's dispatch: "how many requests have I made" is app-internal
-- bookkeeping, not something a user's own session should read or write,
-- even for their own rows — a client that could read its own count could
-- also just... not report a request it made).
