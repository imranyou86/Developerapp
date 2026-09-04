-- Certificate of Occupancy tab — the last per-project tab. One row per
-- project, kept current rather than kept as history: the "Update
-- information" button overwrites this row with a fresh lookup
-- (app/api/claude/lookup-certificate-of-occupancy) rather than
-- accumulating past checks. Best-effort AI web search against public
-- records (primarily LADBS — City of Los Angeles jurisdiction), not a
-- live query against the department's own database.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migration 018_project_subcontractors.sql applied.

create table if not exists certificate_of_occupancy_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects (id) on delete cascade,
  status text,
  co_number text,
  issued_date text,
  open_clearances jsonb not null default '[]'::jsonb,
  permits jsonb not null default '[]'::jsonb,
  inspector jsonb,
  source_url text,
  confidence text check (confidence in ('high', 'medium', 'low')),
  notes text,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_certificate_of_occupancy_checks_project on certificate_of_occupancy_checks (project_id);

alter table certificate_of_occupancy_checks enable row level security;

drop policy if exists "certificate_of_occupancy_checks_member" on certificate_of_occupancy_checks;
create policy "certificate_of_occupancy_checks_member" on certificate_of_occupancy_checks
  for all using (has_project_access(project_id)) with check (has_project_access(project_id));

alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'finish-id', 'checklist', 'budget', 'cost', 'payments', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy'));

-- Defaults visible to every role, Contractor included — inspection/
-- clearance status is field-relevant info, not a financial tab.
insert into tab_permissions (role, tab, allowed)
select r.role, 'certificate-of-occupancy', true
from (values ('owner'), ('pm'), ('contractor'), ('developer')) as r(role)
on conflict (role, tab) do nothing;
