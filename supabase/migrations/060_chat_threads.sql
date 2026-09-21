-- Scoped chat threads — alongside the existing project-wide chat (still the
-- default "General" stream, untouched), a Developer/Contractor/PM can start
-- a named thread with just a subset of the team (typically: themselves, the
-- owner, and one subcontractor account on the project) instead of every
-- message going to the whole project.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-059 applied.

create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists chat_thread_participants (
  thread_id uuid not null references chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (thread_id, user_id)
);

-- Same shape as project_chat_reads, scoped to a thread instead of a whole
-- project — lets the thread list show which threads have unread messages.
create table if not exists chat_thread_reads (
  thread_id uuid not null references chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- Null means "the project-wide General chat" (existing behavior,
-- unchanged); set means this message belongs to one scoped thread instead
-- and only that thread's participants can see it.
alter table project_messages add column if not exists thread_id uuid references chat_threads (id) on delete cascade;

create index if not exists idx_chat_threads_project on chat_threads (project_id, created_at desc);
create index if not exists idx_chat_thread_participants_user on chat_thread_participants (user_id);
create index if not exists idx_project_messages_thread on project_messages (thread_id, created_at);

alter table chat_threads enable row level security;
alter table chat_thread_participants enable row level security;
alter table chat_thread_reads enable row level security;

create or replace function is_thread_participant(tid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_developer() or exists (
    select 1 from chat_thread_participants p where p.thread_id = tid and p.user_id = auth.uid()
  );
$$;

-- Only Developer/Contractor/PM project members can start a thread —
-- Owner and Warranty accounts can be included as participants but don't
-- get the "+ New thread" option themselves.
create or replace function can_create_chat_thread(pid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select has_project_access(pid) and exists (
    select 1 from profiles where id = auth.uid() and role in ('developer', 'contractor', 'pm')
  );
$$;

create policy "chat_threads_select" on chat_threads
  for select using (is_thread_participant(id));
create policy "chat_threads_insert" on chat_threads
  for insert with check (can_create_chat_thread(project_id) and auth.uid() = created_by);
create policy "chat_threads_delete" on chat_threads
  for delete using (auth.uid() = created_by or is_developer());

create policy "chat_thread_participants_select" on chat_thread_participants
  for select using (is_thread_participant(thread_id));
-- Only the thread's own creator (or a Developer) adds/removes
-- participants — same "creator manages membership" shape as
-- project_shares_owner.
create policy "chat_thread_participants_manage" on chat_thread_participants
  for all using (
    exists (select 1 from chat_threads t where t.id = chat_thread_participants.thread_id and (t.created_by = auth.uid() or is_developer()))
  )
  with check (
    exists (select 1 from chat_threads t where t.id = chat_thread_participants.thread_id and (t.created_by = auth.uid() or is_developer()))
  );

create policy "chat_thread_reads_owner" on chat_thread_reads
  for all using (auth.uid() = user_id)
  with check (is_thread_participant(thread_id) and auth.uid() = user_id);

-- Replace project_messages' select/insert policies so a thread-scoped
-- message (thread_id not null) is only visible to/postable by that
-- thread's participants, while a General message (thread_id null) keeps
-- exactly its old project-wide behavior.
drop policy if exists "project_messages_select" on project_messages;
drop policy if exists "project_messages_insert" on project_messages;

create policy "project_messages_select" on project_messages
  for select using (
    (thread_id is null and has_project_access(project_id))
    or (thread_id is not null and is_thread_participant(thread_id))
  );
create policy "project_messages_insert" on project_messages
  for insert with check (
    auth.uid() = user_id
    and (
      (thread_id is null and has_project_access(project_id))
      or (thread_id is not null and is_thread_participant(thread_id))
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_threads'
  ) then
    alter publication supabase_realtime add table chat_threads;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_thread_participants'
  ) then
    alter publication supabase_realtime add table chat_thread_participants;
  end if;
end $$;
