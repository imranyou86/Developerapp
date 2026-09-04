-- Associates subcontractors (the shared directory added in migration
-- 017_subcontractors.sql) with specific constructions — many-to-many, since
-- a sub works multiple projects and a project uses multiple subs. Managed
-- from the Subcontractors page: each entry's "Projects" field on the
-- add/edit form.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migration 017_subcontractors.sql applied.

create table if not exists project_subcontractors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  subcontractor_id uuid not null references subcontractors (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, subcontractor_id)
);

create index if not exists idx_project_subcontractors_project on project_subcontractors (project_id);
create index if not exists idx_project_subcontractors_sub on project_subcontractors (subcontractor_id);

alter table project_subcontractors enable row level security;

-- Scoped by project access, not by who added the subcontractor row — any
-- project member can tag a sub as being used on their project, regardless
-- of who originally added that sub to the shared directory.
drop policy if exists "project_subcontractors_member" on project_subcontractors;
create policy "project_subcontractors_member" on project_subcontractors
  for all using (has_project_access(project_id)) with check (has_project_access(project_id));
