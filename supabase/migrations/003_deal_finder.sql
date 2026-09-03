-- Adds Deal Finder: search for-sale listings by ZIP (via RentCast), pull
-- comps/value estimates, and evaluate whether a property is worth buying and
-- building — independent of any construction project until you decide to
-- pursue one.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied. Safe to run — it only creates new
-- objects, it doesn't touch anything that already exists.

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  address text not null,
  city text,
  state text,
  zip_code text not null,
  list_price numeric,
  beds numeric,
  baths numeric,
  sqft numeric,
  lot_size numeric,
  year_built int,
  listing_url text,
  photo_url text,
  status text not null default 'researching' check (status in ('researching', 'pursuing', 'passed', 'converted')),
  project_id uuid references projects (id) on delete set null,
  raw_listing jsonb,
  created_at timestamptz not null default now()
);

create table if not exists deal_analyses (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals (id) on delete cascade,
  scope text not null default 'remodel' check (scope in ('remodel', 'ground_up')),
  scope_description text,
  cost_per_sqft numeric not null default 400,
  construction_budget numeric not null,
  current_value_estimate numeric,
  arv_estimate numeric,
  arv_low numeric,
  arv_high numeric,
  total_cost numeric not null,
  estimated_profit numeric,
  profit_margin_pct numeric,
  verdict text not null check (verdict in ('good_deal', 'marginal', 'pass')),
  reasoning text,
  comps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_deals_user on deals (user_id, created_at desc);
create index if not exists idx_deal_analyses_deal on deal_analyses (deal_id, created_at desc);

alter table deals enable row level security;
alter table deal_analyses enable row level security;

create policy "deals_owner" on deals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "deal_analyses_owner" on deal_analyses
  for all using (exists (select 1 from deals d where d.id = deal_analyses.deal_id and d.user_id = auth.uid()))
  with check (exists (select 1 from deals d where d.id = deal_analyses.deal_id and d.user_id = auth.uid()));
