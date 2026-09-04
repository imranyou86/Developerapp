-- Lets a plan page be marked as a floor-plan layout sheet vs. everything
-- else in a plan set (elevations, sections, details, structural/MEP
-- sheets). Room detection and cost estimation only read pages marked as
-- layout, which is both faster (smaller request) and more accurate (no
-- irrelevant sheets diluting the read).
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied. Safe to run — defaults to true,
-- so existing plan pages behave exactly as before until narrowed down.

alter table plan_pages add column if not exists is_layout boolean not null default true;
