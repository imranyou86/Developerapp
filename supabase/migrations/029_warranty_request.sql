-- Warranty Request tab + "warranty" role — a homeowner given access once
-- their construction is complete, so they can log issues that need fixing
-- under warranty. Reuses checklist_items/checklist_photos (same shape:
-- title/done/comment/photos) with a new phase value rather than a new
-- table — a warranty item IS a checklist item, just one the homeowner
-- files instead of the QA seed list.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-028 applied.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty'));

alter table project_members drop constraint if exists project_members_role_check;
alter table project_members add constraint project_members_role_check
  check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty'));

alter table project_invites drop constraint if exists project_invites_role_check;
alter table project_invites add constraint project_invites_role_check
  check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty'));

alter table tab_permissions drop constraint if exists tab_permissions_role_check;
alter table tab_permissions add constraint tab_permissions_role_check
  check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty'));

alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'checklist', 'budget', 'cost', 'bids', 'payments', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy', 'landscape', 'house-book', 'chat', 'warranty-request'));

alter table checklist_items drop constraint if exists checklist_items_phase_check;
alter table checklist_items add constraint checklist_items_phase_check
  check (phase in ('rough', 'finish', 'warranty'));

-- Give every role a row for the new tab, and every existing role a row for
-- Warranty Request specifically (both sides of the matrix are otherwise
-- missing it). "Warranty" gets every OTHER tab set to false below — its
-- account is meant to see nothing but this one tab, on every construction
-- it can reach.
insert into tab_permissions (role, tab, allowed)
select r.role, t.tab, true
from (values ('owner'), ('pm'), ('contractor'), ('developer'), ('warranty')) as r(role)
cross join (values ('plan'), ('rooms'), ('interior-design'), ('checklist'), ('budget'), ('cost'), ('bids'), ('payments'), ('files'), ('deals'), ('subcontractors'), ('certificate-of-occupancy'), ('landscape'), ('house-book'), ('chat'), ('warranty-request')) as t(tab)
on conflict (role, tab) do nothing;

update tab_permissions set allowed = false where role = 'warranty' and tab <> 'warranty-request';
