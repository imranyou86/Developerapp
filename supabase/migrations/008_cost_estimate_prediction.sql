-- Adds a single "most accurate" AI-predicted construction cost, separate from
-- the low/mid/high tier range: predicted_cost_per_sqft/predicted_total_cost is
-- Claude's best single-point estimate (with a contingency % for what the plan
-- can't show), plus its confidence and reasoning for that specific number.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied. Safe to run — existing rows just
-- get these new columns as null until a new estimate is generated.

alter table cost_estimates add column if not exists predicted_cost_per_sqft numeric;
alter table cost_estimates add column if not exists contingency_pct numeric;
alter table cost_estimates add column if not exists predicted_total_cost numeric;
alter table cost_estimates add column if not exists prediction_confidence text;
alter table cost_estimates add column if not exists prediction_notes text;
