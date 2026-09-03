-- Adds zoning fields for ground-up buildable-sqft calculation. ZIMAS
-- (zimas.lacity.org) has no public API, so these are entered manually, once
-- per deal, and remembered from then on.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql (and migrations 001-003) applied. Safe to
-- run — it only adds columns, it doesn't touch anything that already exists.

alter table deals add column if not exists zone text;
alter table deals add column if not exists lot_coverage_pct numeric;

alter table deal_analyses add column if not exists target_sqft numeric;
