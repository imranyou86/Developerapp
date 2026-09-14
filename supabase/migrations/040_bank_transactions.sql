-- Bank Transactions tab (per-project): import a bank-exported CSV of
-- transactions, parsed client-side (lib/bankCsv.ts — deterministic, no AI
-- call needed for structured tabular data) into individual rows here, each
-- optionally linked to a bid so "how much has actually been paid toward
-- this bid" can be tracked against payment_schedule_items' planned amounts.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-039 applied.

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  bid_id uuid references bids (id) on delete set null,
  txn_date date not null,
  description text not null,
  amount numeric not null,
  type text not null check (type in ('debit', 'credit')),
  source_file_name text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Re-importing the same statement (overlapping date ranges are common when
-- someone re-exports "this month plus last month") silently no-ops instead
-- of duplicating rows — see the ignoreDuplicates upsert in
-- app/projects/[id]/bank-transactions/actions.ts.
create unique index if not exists idx_bank_transactions_dedupe on bank_transactions (project_id, txn_date, description, amount, type);
create index if not exists idx_bank_transactions_project on bank_transactions (project_id, txn_date desc);
create index if not exists idx_bank_transactions_bid on bank_transactions (bid_id);

alter table bank_transactions enable row level security;

drop policy if exists "bank_transactions_member" on bank_transactions;
create policy "bank_transactions_member" on bank_transactions
  for all using (has_project_access(bank_transactions.project_id))
  with check (has_project_access(bank_transactions.project_id));

-- Add the new tab to the same Developer-editable visibility matrix as the
-- other project tabs — hidden from Contractor and Warranty by default, same
-- as Bids/Payments/Budget (financial info, not field-relevant).
alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'checklist', 'budget', 'cost', 'bids', 'payments', 'bank-transactions', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy', 'landscape', 'house-book', 'chat', 'warranty-request'));

insert into tab_permissions (role, tab, allowed)
select r.role, 'bank-transactions', case when r.role in ('contractor', 'warranty') then false else true end
from (values ('owner'), ('pm'), ('contractor'), ('developer'), ('warranty')) as r(role)
on conflict (role, tab) do nothing;
