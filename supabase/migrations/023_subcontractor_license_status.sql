-- CSLB (California's Contractors State License Board) has no public API and
-- its license-check tool is an interactive page, not something a server-side
-- web search or an iframe can drive reliably (the same conclusion already
-- reached for LADBS's property lookup tool in migration 019) — so "look up
-- this license" opens CSLB's real check-license page in a new tab
-- (best-effort deep-linked by license number) rather than trying to scrape
-- or parse a result automatically. These two columns let whoever checked it
-- record what they saw, same manual-findings pattern as Certificate of
-- Occupancy.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migration 022_bids_tab.sql applied.

alter table subcontractors add column if not exists license_status text;
alter table subcontractors add column if not exists license_checked_at timestamptz;
