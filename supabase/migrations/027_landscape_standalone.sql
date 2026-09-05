-- Landscape gets a "Standalone Photos" mode — a design not tied to any
-- tracked construction (a random exterior photo, someone else's listing,
-- etc.). project_id becomes optional; created_by backs the RLS for a
-- standalone row, same shape as finish_scans's universal-directory RLS.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-026 applied.

alter table landscape_designs add column if not exists created_by uuid references auth.users (id) on delete cascade;

-- Backfill: every existing row is currently project-tied, so its creator is
-- unrecoverable from data alone — attribute it to that project's owner, the
-- same stand-in used for finish_scans's equivalent backfill.
update landscape_designs ld
set created_by = p.user_id
from projects p
where p.id = ld.project_id and ld.created_by is null;

alter table landscape_designs alter column created_by set not null;
alter table landscape_designs alter column project_id drop not null;

drop policy if exists "landscape_designs_member" on landscape_designs;

create policy "landscape_designs_select" on landscape_designs
  for select using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and auth.uid() is not null)
  );
create policy "landscape_designs_insert" on landscape_designs
  for insert with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and auth.uid() = created_by)
  );
create policy "landscape_designs_update" on landscape_designs
  for update using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  ) with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
create policy "landscape_designs_delete" on landscape_designs
  for delete using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
