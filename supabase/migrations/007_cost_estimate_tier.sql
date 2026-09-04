-- Adds a low/mid/high cost tier to cost_estimates. Claude now picks which
-- tier fits the plan's assessed quality/complexity and prices within that
-- tier's fixed $/sqft band (low $250-300, mid $350-400, high $450+) instead
-- of inventing an open-ended range.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied. Safe to run — existing rows just
-- get cost_tier = null until a new estimate is generated.

alter table cost_estimates add column if not exists cost_tier text;
