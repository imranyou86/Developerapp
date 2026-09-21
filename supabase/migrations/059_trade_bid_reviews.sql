-- Construction Cost's new "Trade Bid Review" section — separate from the
-- Bids tab's whole-contract/GC bids (which track a payment draw schedule
-- through to Payments once accepted). This is a lighter-weight record: one
-- subcontractor's bid for one trade, evaluated for price fairness, scope
-- completeness, and good clarifying questions to ask before signing —
-- never flows into Payments itself.
create table if not exists trade_bid_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  trade text not null,
  subcontractor_name text not null,
  -- Optional link to the shared subcontractor directory, when this bid
  -- came from a sub already added there — set null (not deleted) if that
  -- subcontractor is later removed, same as warranty_item_requests.subcontractor_id.
  subcontractor_id uuid references subcontractors (id) on delete set null,
  bid_amount numeric not null default 0,
  -- What the sub says is included — pasted in or typed by whoever's
  -- reviewing it, since a subcontractor bid's scope rarely comes as a
  -- clean payment schedule the way extract-bid's GC bids do.
  scope_notes text,
  file_name text,
  file_url text,
  -- Cached result of "Evaluate" (web-search-grounded price/scope check) —
  -- same "plain columns, latest evaluation wins, re-evaluating overwrites"
  -- pattern as bids.evaluation_*.
  evaluation_verdict text check (evaluation_verdict in ('good_price', 'fair_price', 'high_price')),
  evaluation_confidence text check (evaluation_confidence in ('high', 'medium', 'low')),
  evaluation_market_low numeric,
  evaluation_market_high numeric,
  evaluation_analysis text,
  evaluation_questions jsonb not null default '[]'::jsonb,
  evaluation_scope_complete boolean,
  evaluation_missing_items jsonb not null default '[]'::jsonb,
  evaluation_completeness_note text,
  evaluated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_trade_bid_reviews_project on trade_bid_reviews (project_id, created_at desc);

alter table trade_bid_reviews enable row level security;

create policy "trade_bid_reviews_member" on trade_bid_reviews
  for all using (has_project_access(trade_bid_reviews.project_id))
  with check (has_project_access(trade_bid_reviews.project_id));

-- Reuses the existing "bid-files" storage bucket/policy (private, path
-- prefixed by the uploader's own auth.uid()) — no new bucket needed, this
-- is the same kind of file a Bids-tab upload already is.

alter table project_files drop constraint if exists project_files_category_check;
alter table project_files add constraint project_files_category_check
  check (category in ('plan', 'bid', 'trade_bid', 'checklist_photo', 'rendering', 'finish_scan', 'document', 'photo', 'interior_design', 'landscape_design'));

-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-058 applied.
