-- Only a Developer or Contractor can create a new construction, or edit
-- (rename/re-address) or delete an existing one — every other role
-- (Owner, PM, Warranty) can still be a project_member of a construction and
-- use whatever tabs it's allowed, but can no longer manage the
-- construction record itself. Previously any signed-in user could create
-- a project (and its own owner, or a Developer, could edit/delete it) with
-- no role check at all.

create or replace function can_manage_projects()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('developer', 'contractor'));
$$;

drop policy if exists "projects_insert" on projects;
create policy "projects_insert" on projects
  -- No has_project_access(id) check here — the row doesn't exist yet, so
  -- there's nothing to have "access" to until after it's created; the role
  -- check alone is the gate for who can create one at all.
  for insert with check (auth.uid() = user_id and can_manage_projects());

drop policy if exists "projects_update" on projects;
create policy "projects_update" on projects
  for update using (can_manage_projects() and has_project_access(id))
  with check (can_manage_projects() and has_project_access(id));

drop policy if exists "projects_delete" on projects;
create policy "projects_delete" on projects
  for delete using (can_manage_projects() and has_project_access(id));

-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-046 applied.
