-- Bank Transactions tab, tax-prep support: a category on each transaction
-- (imported or manual) so a Profit & Loss statement can group costs/revenue
-- sensibly, plus manual entries for anything that never hits the bank
-- statement (property acquisition folded into closing costs elsewhere, a
-- cash payment, a contributed cost, etc.) — those are just ordinary
-- bank_transactions rows with source_file_name left null, inserted directly
-- rather than via CSV import. No new table needed.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-040 applied.

alter table bank_transactions add column if not exists category text;
