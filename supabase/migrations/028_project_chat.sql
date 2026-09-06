-- Chat tab (per-project): one running thread per construction, visible to
-- everyone with access to that project. New messages stream live via
-- Supabase Realtime's postgres_changes (which respects RLS on its own).
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-027 applied.

-- sender_email is denormalized at write time (from auth.getUser(), not a
-- join) deliberately — profiles_select only lets a user read their own
-- profile row, so a co-member's email couldn't be resolved for display via
-- a profiles join without loosening that policy app-wide. Storing it on
-- the message avoids needing to at all.
create table if not exists project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_email text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_messages_project on project_messages (project_id, created_at);

alter table project_messages enable row level security;

drop policy if exists "project_messages_select" on project_messages;
drop policy if exists "project_messages_insert" on project_messages;
drop policy if exists "project_messages_delete" on project_messages;

create policy "project_messages_select" on project_messages
  for select using (has_project_access(project_id));
create policy "project_messages_insert" on project_messages
  for insert with check (has_project_access(project_id) and auth.uid() = user_id);
create policy "project_messages_delete" on project_messages
  for delete using (auth.uid() = user_id or is_developer());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_messages'
  ) then
    alter publication supabase_realtime add table project_messages;
  end if;
end $$;

-- Add the new tab to the same Developer-editable visibility matrix as the
-- other project tabs — defaults visible to everyone, Contractor included
-- (team communication is field-relevant, not a financial tab).
alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'checklist', 'budget', 'cost', 'bids', 'payments', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy', 'landscape', 'house-book', 'chat'));

insert into tab_permissions (role, tab, allowed)
select r.role, 'chat', true
from (values ('owner'), ('pm'), ('contractor'), ('developer')) as r(role)
on conflict (role, tab) do nothing;
