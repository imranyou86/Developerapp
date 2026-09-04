-- Adds the File Library: a project_files table that aggregates every
-- uploaded file across the app (plan pages, bid files, checklist photos,
-- rendering photos, finish scans) into one list per project, kept in sync
-- by the upload/delete actions in each feature. It's a convenience index
-- over the existing feature tables, not a second source of truth for them.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied.

create table if not exists project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  storage_url text not null,
  file_name text not null,
  category text not null check (category in ('plan', 'bid', 'checklist_photo', 'rendering', 'finish_scan')),
  source_table text not null,
  source_id uuid not null,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_project_files_source on project_files (source_table, source_id);
create index if not exists idx_project_files_project on project_files (project_id, created_at desc);

alter table project_files enable row level security;

create policy "project_files_owner" on project_files
  for all using (exists (select 1 from projects p where p.id = project_files.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_files.project_id and p.user_id = auth.uid()));
