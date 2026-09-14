-- Bank Transactions tab: whether a transaction actually counts toward the
-- Profit & Loss statement. Not every bank-feed debit is a real business
-- expense (a transfer between the owner's own accounts, a loan principal
-- payment, etc.), so the P&L is no longer "everything imported" by default —
-- it only sums rows explicitly marked in, via a per-row checkbox or a bulk
-- action over a filtered/selected set in the UI (app/projects/[id]/bank-
-- transactions/bank-transactions-client.tsx).
--
-- Defaults false for bulk-imported CSV rows (unreviewed data shouldn't
-- silently count as real expenses/revenue) but the client defaults manual
-- entries' checkbox to true, since a manual entry is a single deliberate
-- action, not bulk data — see addManualTransaction's `includeInPl` input in
-- app/projects/[id]/bank-transactions/actions.ts.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-041 applied.

alter table bank_transactions add column if not exists include_in_pl boolean not null default false;
