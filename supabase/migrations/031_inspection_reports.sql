-- Inspection reports (Warranty Request tab) — upload any file type (PDF,
-- photos, scans), stored in the same 'project-files' bucket the Files tab
-- already uses (no new bucket/storage policy needed). checklist_item_id
-- starts null (just uploaded, not yet tied to a specific issue) and can be
-- set/cleared afterward to attach the same report to one warranty
-- checklist item.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-030 applied.

create table if not exists inspection_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  checklist_item_id uuid references checklist_items (id) on delete set null,
  file_name text not null,
  storage_url text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_inspection_reports_project on inspection_reports (project_id, created_at desc);
create index if not exists idx_inspection_reports_checklist_item on inspection_reports (checklist_item_id);

alter table inspection_reports enable row level security;

drop policy if exists "inspection_reports_member" on inspection_reports;
create policy "inspection_reports_member" on inspection_reports
  for all using (has_project_access(inspection_reports.project_id))
  with check (has_project_access(inspection_reports.project_id));
