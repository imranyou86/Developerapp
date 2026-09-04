-- Shared subcontractor directory: company/contact info, license #/state,
-- phone, address, and a reliability (1-5 stars) + cost ($ 1-4) tag per sub.
-- Not scoped to a single project — any signed-in user can look one up
-- while working any construction; only whoever added an entry, or a
-- Developer, can edit/remove it. Also adds "subcontractors" to the same
-- Developer-editable tab_permissions matrix as Buyers Guide/Interior
-- Design, defaulting hidden for Contractor.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migration 016_access_requests.sql applied.

create table if not exists subcontractors (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete cascade,
  company_name text not null,
  contact_name text,
  trade text,
  phone text,
  email text,
  address text,
  license_number text,
  license_state text,
  reliability smallint check (reliability between 1 and 5),
  cost_tier smallint check (cost_tier between 1 and 4),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_subcontractors_created_by on subcontractors (created_by);
create index if not exists idx_subcontractors_company_name on subcontractors (company_name);

alter table subcontractors enable row level security;

drop policy if exists "subcontractors_select" on subcontractors;
create policy "subcontractors_select" on subcontractors
  for select using (auth.uid() is not null);

drop policy if exists "subcontractors_insert" on subcontractors;
create policy "subcontractors_insert" on subcontractors
  for insert with check (auth.uid() = created_by);

drop policy if exists "subcontractors_update" on subcontractors;
create policy "subcontractors_update" on subcontractors
  for update using (auth.uid() = created_by or is_developer()) with check (auth.uid() = created_by or is_developer());

drop policy if exists "subcontractors_delete" on subcontractors;
create policy "subcontractors_delete" on subcontractors
  for delete using (auth.uid() = created_by or is_developer());

alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'finish-id', 'checklist', 'budget', 'cost', 'payments', 'files', 'deals', 'subcontractors'));

insert into tab_permissions (role, tab, allowed)
select r.role, 'subcontractors', case when r.role = 'contractor' then false else true end
from (values ('owner'), ('pm'), ('contractor'), ('developer')) as r(role)
on conflict (role, tab) do nothing;
