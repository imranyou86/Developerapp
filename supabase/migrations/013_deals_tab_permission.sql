-- Adds "deals" (the top-level Buyers Guide section) to the same
-- role-based tab_permissions matrix that already governs the 8 per-project
-- tabs, so a Developer can hide/show Buyers Guide per role from the Admin
-- page too.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migration 012_permissions.sql applied.

alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'finish-id', 'checklist', 'budget', 'cost', 'payments', 'files', 'deals'));

-- Default: visible to Owner/PM/Developer, hidden for Contractor (same
-- default as the other financial-ish tabs) — Developer-editable afterwards.
insert into tab_permissions (role, tab, allowed)
select r.role, 'deals', case when r.role = 'contractor' then false else true end
from (values ('owner'), ('pm'), ('contractor'), ('developer')) as r(role)
on conflict (role, tab) do nothing;
