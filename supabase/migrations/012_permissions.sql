-- Role-based permissions: account-level login types (Owner, PM, Contractor,
-- Developer), a Developer-editable tab-permission matrix, and Developer-only
-- project invites.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied.

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, holding their account-level role
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'owner' check (role in ('owner', 'pm', 'contractor', 'developer')),
  created_at timestamptz not null default now()
);

-- Backfill a profile row for every existing auth user (new users get one via
-- the trigger below going forward).
insert into profiles (id, email, role)
select u.id, u.email, 'owner'
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'role', 'owner'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Make imranyousuf86@gmail.com a developer (admin). Safe to re-run.
update profiles set role = 'developer' where lower(email) = 'imranyousuf86@gmail.com';

-- ---------------------------------------------------------------------------
-- tab_permissions — which project tabs each role can see, Developer-editable
-- ---------------------------------------------------------------------------

create table if not exists tab_permissions (
  role text not null check (role in ('owner', 'pm', 'contractor', 'developer')),
  tab text not null check (tab in ('plan', 'rooms', 'finish-id', 'checklist', 'budget', 'cost', 'payments', 'files')),
  allowed boolean not null default true,
  primary key (role, tab)
);

insert into tab_permissions (role, tab, allowed)
select r.role, t.tab, case when r.role = 'contractor' and t.tab in ('finish-id', 'budget', 'cost', 'payments') then false else true end
from (values ('owner'), ('pm'), ('contractor'), ('developer')) as r(role)
cross join (values ('plan'), ('rooms'), ('finish-id'), ('checklist'), ('budget'), ('cost'), ('payments'), ('files')) as t(tab)
on conflict (role, tab) do nothing;

-- ---------------------------------------------------------------------------
-- project_members / project_invites — Developer-only invites onto a project
-- ---------------------------------------------------------------------------

create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'pm', 'contractor', 'developer')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table if not exists project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'pm', 'contractor', 'developer')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists idx_project_members_project on project_members (project_id);
create index if not exists idx_project_members_user on project_members (user_id);
create index if not exists idx_project_invites_project on project_invites (project_id, created_at desc);
create index if not exists idx_project_invites_token on project_invites (token);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so they can be used inside RLS
-- policies on other tables without recursing through those tables' own RLS)
-- ---------------------------------------------------------------------------

create or replace function is_developer()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'developer');
$$;

create or replace function has_project_access(pid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    is_developer()
    or exists (select 1 from projects p where p.id = pid and p.user_id = auth.uid())
    or exists (select 1 from project_members m where m.project_id = pid and m.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- RLS — new tables
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table tab_permissions enable row level security;
alter table project_members enable row level security;
alter table project_invites enable row level security;

drop policy if exists "profiles_select" on profiles;
create policy "profiles_select" on profiles
  for select using (auth.uid() = id or is_developer());

drop policy if exists "profiles_update" on profiles;
create policy "profiles_update" on profiles
  for update using (is_developer()) with check (is_developer());

drop policy if exists "tab_permissions_select" on tab_permissions;
create policy "tab_permissions_select" on tab_permissions
  for select using (auth.uid() is not null);

drop policy if exists "tab_permissions_write" on tab_permissions;
create policy "tab_permissions_write" on tab_permissions
  for all using (is_developer()) with check (is_developer());

drop policy if exists "project_members_select" on project_members;
create policy "project_members_select" on project_members
  for select using (has_project_access(project_id));

drop policy if exists "project_members_insert" on project_members;
create policy "project_members_insert" on project_members
  for insert with check (
    is_developer()
    or (
      auth.uid() = user_id
      and exists (
        select 1 from project_invites i
        where i.project_id = project_members.project_id
          and lower(i.email) = lower(auth.email())
          and i.status = 'pending'
      )
    )
  );

drop policy if exists "project_members_delete" on project_members;
create policy "project_members_delete" on project_members
  for delete using (
    is_developer()
    or exists (select 1 from projects p where p.id = project_members.project_id and p.user_id = auth.uid())
  );

drop policy if exists "project_invites_all" on project_invites;
create policy "project_invites_all" on project_invites
  for all using (is_developer()) with check (is_developer());

-- ---------------------------------------------------------------------------
-- RLS — widen every existing project-scoped policy from "owner only" to
-- "owner, invited project member, or developer" via has_project_access().
-- ---------------------------------------------------------------------------

drop policy if exists "projects_owner" on projects;
create policy "projects_select" on projects
  for select using (has_project_access(id));
create policy "projects_insert" on projects
  for insert with check (auth.uid() = user_id);
create policy "projects_update" on projects
  for update using (auth.uid() = user_id or is_developer()) with check (auth.uid() = user_id or is_developer());
create policy "projects_delete" on projects
  for delete using (auth.uid() = user_id or is_developer());

drop policy if exists "plan_pages_owner" on plan_pages;
create policy "plan_pages_member" on plan_pages
  for all using (has_project_access(plan_pages.project_id))
  with check (has_project_access(plan_pages.project_id));

drop policy if exists "rooms_owner" on rooms;
create policy "rooms_member" on rooms
  for all using (has_project_access(rooms.project_id))
  with check (has_project_access(rooms.project_id));

drop policy if exists "tasks_owner" on tasks;
create policy "tasks_member" on tasks
  for all using (exists (select 1 from rooms r where r.id = tasks.room_id and has_project_access(r.project_id)))
  with check (exists (select 1 from rooms r where r.id = tasks.room_id and has_project_access(r.project_id)));

drop policy if exists "budget_items_owner" on budget_items;
create policy "budget_items_member" on budget_items
  for all using (exists (select 1 from rooms r where r.id = budget_items.room_id and has_project_access(r.project_id)))
  with check (exists (select 1 from rooms r where r.id = budget_items.room_id and has_project_access(r.project_id)));

drop policy if exists "finishes_owner" on finishes;
create policy "finishes_member" on finishes
  for all using (exists (select 1 from rooms r where r.id = finishes.room_id and has_project_access(r.project_id)))
  with check (exists (select 1 from rooms r where r.id = finishes.room_id and has_project_access(r.project_id)));

drop policy if exists "finish_scans_owner" on finish_scans;
create policy "finish_scans_member" on finish_scans
  for all using (has_project_access(finish_scans.project_id))
  with check (has_project_access(finish_scans.project_id));

drop policy if exists "cost_estimates_owner" on cost_estimates;
create policy "cost_estimates_member" on cost_estimates
  for all using (has_project_access(cost_estimates.project_id))
  with check (has_project_access(cost_estimates.project_id));

drop policy if exists "renderings_owner" on renderings;
create policy "renderings_member" on renderings
  for all using (exists (select 1 from rooms r where r.id = renderings.room_id and has_project_access(r.project_id)))
  with check (exists (select 1 from rooms r where r.id = renderings.room_id and has_project_access(r.project_id)));

drop policy if exists "checklist_items_owner" on checklist_items;
create policy "checklist_items_member" on checklist_items
  for all using (has_project_access(checklist_items.project_id))
  with check (has_project_access(checklist_items.project_id));

drop policy if exists "checklist_photos_owner" on checklist_photos;
create policy "checklist_photos_member" on checklist_photos
  for all using (exists (select 1 from checklist_items c where c.id = checklist_photos.checklist_item_id and has_project_access(c.project_id)))
  with check (exists (select 1 from checklist_items c where c.id = checklist_photos.checklist_item_id and has_project_access(c.project_id)));

drop policy if exists "bids_owner" on bids;
create policy "bids_member" on bids
  for all using (has_project_access(bids.project_id))
  with check (has_project_access(bids.project_id));

drop policy if exists "payment_schedule_items_owner" on payment_schedule_items;
create policy "payment_schedule_items_member" on payment_schedule_items
  for all using (exists (select 1 from bids b where b.id = payment_schedule_items.bid_id and has_project_access(b.project_id)))
  with check (exists (select 1 from bids b where b.id = payment_schedule_items.bid_id and has_project_access(b.project_id)));

-- Share links stay owner+developer only (inviting a project member to send
-- out anonymous public links isn't part of this feature).
drop policy if exists "project_shares_owner" on project_shares;
create policy "project_shares_owner" on project_shares
  for all using (exists (select 1 from projects p where p.id = project_shares.project_id and p.user_id = auth.uid()) or is_developer())
  with check (exists (select 1 from projects p where p.id = project_shares.project_id and p.user_id = auth.uid()) or is_developer());

drop policy if exists "project_files_owner" on project_files;
create policy "project_files_member" on project_files
  for all using (has_project_access(project_files.project_id))
  with check (has_project_access(project_files.project_id));
