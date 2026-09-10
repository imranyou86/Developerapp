-- Append-only audit trail for the actions most likely to matter in a
-- dispute or "who did that?" moment: deleting a construction, warranty
-- item deletes/approvals/rejections, bid accept/decline/delete, removing a
-- team member or revoking an invite, and deleting a file from the Files
-- Library. Not every mutation in the app is logged here — see
-- lib/activityLog.ts for exactly which actions call logActivity — this
-- covers the money/warranty/access-related ones, not a full history of
-- every checklist toggle.
--
-- Deliberately no update/delete policy at all (only select/insert below) —
-- an audit log that anyone, including its own author, could edit or erase
-- isn't an audit log.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-037 applied.

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_log_project on activity_log (project_id, created_at desc);

alter table activity_log enable row level security;

drop policy if exists "activity_log_select" on activity_log;
drop policy if exists "activity_log_insert" on activity_log;

create policy "activity_log_select" on activity_log
  for select using (has_project_access(project_id));

create policy "activity_log_insert" on activity_log
  for insert with check (has_project_access(project_id) and auth.uid() = user_id);
