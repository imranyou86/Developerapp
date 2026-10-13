-- New "interior_designer" role — an outside designer account restricted to
-- seeing only the Interior Design top-level tab (Design a room, Mood
-- Boards, Finish ID) on every construction it's added to, same mechanism
-- as the existing "warranty" role being restricted to just
-- warranty-request/chat (see migration 029). No new tab, no new table —
-- just a new allowed value for the existing role columns, plus a
-- tab_permissions seed row set so every tab EXCEPT 'interior-design' is
-- false for this role. Project access itself still works exactly like
-- Contractor/PM — the account needs to be invited to (or added to) a
-- specific construction via project_members/project_invites before it can
-- see it in the Interior Design project picker.
--
-- Run this once in the Supabase SQL editor against an EXISTING project
-- that already has migrations 001-064 applied.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty', 'interior_designer'));

alter table project_members drop constraint if exists project_members_role_check;
alter table project_members add constraint project_members_role_check
  check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty', 'interior_designer'));

alter table project_invites drop constraint if exists project_invites_role_check;
alter table project_invites add constraint project_invites_role_check
  check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty', 'interior_designer'));

alter table tab_permissions drop constraint if exists tab_permissions_role_check;
alter table tab_permissions add constraint tab_permissions_role_check
  check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty', 'interior_designer'));

-- Give the new role a row for every existing tab (both per-project tabs
-- and top-level sections share this one table — see lib/permissions.ts),
-- then immediately restrict it to just 'interior-design'.
insert into tab_permissions (role, tab, allowed)
select 'interior_designer', t.tab, true
from (
  values
    ('plan'), ('rooms'), ('interior-design'), ('checklist'), ('budget'), ('cost'), ('bids'), ('payments'),
    ('bank-transactions'), ('files'), ('deals'), ('subcontractors'), ('certificate-of-occupancy'), ('landscape'),
    ('house-book'), ('chat'), ('warranty-request'), ('activity')
) as t(tab)
on conflict (role, tab) do nothing;

update tab_permissions set allowed = false where role = 'interior_designer' and tab <> 'interior-design';
