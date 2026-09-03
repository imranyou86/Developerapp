-- Adds the Construction Cost tab: reads a project's stored plan pages and
-- estimates total construction cost (sqft x $/sqft, adjusted for complexity
-- factors Claude sees in the plans) with a category breakdown.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied. Safe to run — it only creates a
-- new table, it doesn't touch anything that already exists.

create table if not exists cost_estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  total_sqft numeric,
  stories int,
  quality_tier text,
  cost_per_sqft_low numeric,
  cost_per_sqft_mid numeric,
  cost_per_sqft_high numeric,
  total_cost_low numeric,
  total_cost_mid numeric,
  total_cost_high numeric,
  complexity_factors jsonb not null default '[]'::jsonb,
  breakdown jsonb not null default '[]'::jsonb,
  reasoning text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cost_estimates_project on cost_estimates (project_id, created_at desc);

alter table cost_estimates enable row level security;

create policy "cost_estimates_owner" on cost_estimates
  for all using (exists (select 1 from projects p where p.id = cost_estimates.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = cost_estimates.project_id and p.user_id = auth.uid()));
