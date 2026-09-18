-- Construction Cost gets a "Standalone Plan" mode, same shape as Landscape's
-- "Standalone Photos" (migration 027) — an estimate for a plan that isn't
-- tied to any tracked construction (an addition, ADU, renovation, or any
-- other building project you want priced before it's ever added here).
-- project_id becomes optional on both plan_pages and cost_estimates;
-- created_by backs the RLS for a standalone row. This also lets plan pages
-- be uploaded directly from the Construction Cost page itself, not just the
-- Plan tab — cost estimation no longer requires a detour through a
-- different tab first.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-050 applied.

alter table plan_pages add column if not exists created_by uuid references auth.users (id) on delete cascade;
update plan_pages pp set created_by = p.user_id from projects p where p.id = pp.project_id and pp.created_by is null;
alter table plan_pages alter column created_by set not null;
alter table plan_pages alter column project_id drop not null;

alter table cost_estimates add column if not exists created_by uuid references auth.users (id) on delete cascade;
update cost_estimates ce set created_by = p.user_id from projects p where p.id = ce.project_id and ce.created_by is null;
alter table cost_estimates alter column created_by set not null;
alter table cost_estimates alter column project_id drop not null;
-- Freeform labeling for a standalone estimate, which has no construction
-- name/address of its own to display alongside its history.
alter table cost_estimates add column if not exists title text;
alter table cost_estimates add column if not exists location text;

drop policy if exists "plan_pages_member" on plan_pages;

-- Unlike Landscape's "Standalone Photos" (a shared directory of one-off
-- reference images), a standalone plan is a private multi-page working set
-- plus a running estimate history — so it's visible only to its own
-- creator (or a Developer), not every signed-in user.
create policy "plan_pages_select" on plan_pages
  for select using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
create policy "plan_pages_insert" on plan_pages
  for insert with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and auth.uid() = created_by)
  );
create policy "plan_pages_update" on plan_pages
  for update using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  ) with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
create policy "plan_pages_delete" on plan_pages
  for delete using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );

drop policy if exists "cost_estimates_member" on cost_estimates;

-- Same reasoning as plan_pages_select above — private to its own creator,
-- not a shared directory.
create policy "cost_estimates_select" on cost_estimates
  for select using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
create policy "cost_estimates_insert" on cost_estimates
  for insert with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and auth.uid() = created_by)
  );
create policy "cost_estimates_update" on cost_estimates
  for update using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  ) with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
create policy "cost_estimates_delete" on cost_estimates
  for delete using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
