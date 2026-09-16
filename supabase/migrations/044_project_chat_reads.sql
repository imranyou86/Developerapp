-- Chat tab: tracks the last time each member read a given construction's
-- chat, so the tab strip (app/projects/[id]/project-tabs.tsx) can show an
-- unread-count badge on "Chat" — one row per (project, user), upserted to
-- now() whenever that user is actively viewing the chat page (see
-- markChatRead in app/projects/[id]/chat/actions.ts). No row yet means
-- "never read this project's chat," so every existing message counts as
-- unread the first time, same as most chat apps.
create table if not exists project_chat_reads (
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table project_chat_reads enable row level security;

-- Self-service only, same shape as project_alert_subscriptions — a user
-- manages just their own read marker, never another member's.
create policy "project_chat_reads_owner" on project_chat_reads
  for all using (auth.uid() = user_id)
  with check (has_project_access(project_id) and auth.uid() = user_id);

-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-043 applied.
