-- Per-project Activity tab: surfaces the activity_log audit trail (recorded
-- since migration 038) in the UI for the first time. Nothing new is
-- persisted for the events themselves — this just adds actor_name (a
-- denormalized display name/email, same reasoning as
-- project_messages.sender_name — profiles_select only lets a user read
-- their own row) and a tab_permissions/user_tab_permissions row like every
-- other per-project tab.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-051 applied.

alter table activity_log add column if not exists actor_name text;

alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'checklist', 'budget', 'cost', 'bids', 'payments', 'bank-transactions', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy', 'landscape', 'house-book', 'chat', 'warranty-request', 'activity'));

alter table user_tab_permissions drop constraint if exists user_tab_permissions_tab_check;
alter table user_tab_permissions add constraint user_tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'checklist', 'budget', 'cost', 'bids', 'payments', 'bank-transactions', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy', 'landscape', 'house-book', 'chat', 'warranty-request', 'activity'));

-- Same visibility as every other management-facing tab: everyone except
-- the 'warranty' role, which stays limited to warranty-request/chat.
insert into tab_permissions (role, tab, allowed)
select r.role, 'activity', case when r.role = 'warranty' then false else true end
from (values ('owner'), ('pm'), ('contractor'), ('developer'), ('warranty')) as r(role)
on conflict (role, tab) do nothing;
