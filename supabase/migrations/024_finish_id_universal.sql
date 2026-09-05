-- Finish ID moves from a per-project tab to a universal section (surfaced
-- under Interior Design) — you can identify finishes from a photo without
-- picking a construction first. Individual identified finishes still only
-- get attached to a specific construction's room when explicitly sent there
-- (addFinish, unchanged) — only the scan itself stops being project-scoped.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-023 applied.

alter table finish_scans add column if not exists created_by uuid references auth.users (id) on delete cascade;

-- Backfill: attribute pre-existing scans to their project's owner, the
-- closest stand-in for "who created this" available before this column
-- existed.
update finish_scans fs
set created_by = p.user_id
from projects p
where p.id = fs.project_id and fs.created_by is null;

alter table finish_scans alter column created_by set not null;
alter table finish_scans alter column project_id drop not null;

-- Same shared-directory RLS shape as subcontractors: any signed-in user can
-- see every scan, but only its own creator (or a Developer) can change or
-- remove it — has_project_access() no longer applies since a scan isn't
-- necessarily tied to one construction's membership anymore.
drop policy if exists "finish_scans_member" on finish_scans;

create policy "finish_scans_select" on finish_scans
  for select using (auth.uid() is not null);
create policy "finish_scans_insert" on finish_scans
  for insert with check (auth.uid() = created_by);
create policy "finish_scans_update" on finish_scans
  for update using (auth.uid() = created_by or is_developer()) with check (auth.uid() = created_by or is_developer());
create policy "finish_scans_delete" on finish_scans
  for delete using (auth.uid() = created_by or is_developer());

-- Finish ID's visibility is now governed by the 'interior-design' tab
-- permission it's nested under, so its own tab_permissions rows (one per
-- role, added back in migration 012) are no longer read by the app — remove
-- them here (rather than just leaving them unused) so a later migration can
-- tighten tab_permissions_tab_check back down without those rows violating it.
delete from tab_permissions where tab = 'finish-id';
