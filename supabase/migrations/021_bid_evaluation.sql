-- "Evaluate bid" in the new Incoming bids review section grounds a bid's
-- price against typical market cost for the described scope (web search),
-- so it's worth caching the result rather than re-running the search every
-- time the page reloads — a bid only ever needs its latest evaluation
-- (unlike Buyers Guide's deal_analyses, which keeps a history across
-- re-analyses of the same deal), so plain columns on bids are enough; no
-- separate table needed.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migration 020_bid_status.sql applied.

alter table bids add column if not exists evaluation_verdict text check (evaluation_verdict in ('good_price', 'fair_price', 'high_price'));
alter table bids add column if not exists evaluation_confidence text check (evaluation_confidence in ('high', 'medium', 'low'));
alter table bids add column if not exists evaluation_market_low numeric;
alter table bids add column if not exists evaluation_market_high numeric;
alter table bids add column if not exists evaluation_analysis text;
alter table bids add column if not exists evaluated_at timestamptz;
