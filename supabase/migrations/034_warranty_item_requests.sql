-- Warranty role permission overhaul:
--   1. Give the 'warranty' role Chat tab access alongside Warranty Request
--      (they can talk to the team about what they're filing, not just file it).
--   2. Make the Warranty Request tab view-only for that role — they can watch
--      checklist items, notes, and photos, but can no longer add/toggle/edit/
--      delete anything directly (enforced app-side, in the Server Actions —
--      see the role guard in app/projects/[id]/warranty-request/actions.ts).
--   3. Add a request/approval queue: instead of adding a warranty item
--      directly, a 'warranty' user files a request here; a Contractor or
--      Developer approves it (which creates the real checklist_items row,
--      phase='warranty', linked back via checklist_item_id) or rejects it.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-033 applied.

update tab_permissions set allowed = true where role = 'warranty' and tab = 'chat';

create table if not exists warranty_item_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  title text not null,
  comment text,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  checklist_item_id uuid references checklist_items (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_warranty_item_requests_project on warranty_item_requests (project_id, status, created_at);

alter table warranty_item_requests enable row level security;

drop policy if exists "warranty_item_requests_select" on warranty_item_requests;
drop policy if exists "warranty_item_requests_insert" on warranty_item_requests;
drop policy if exists "warranty_item_requests_update" on warranty_item_requests;
drop policy if exists "warranty_item_requests_delete" on warranty_item_requests;

-- Anyone with project access can see the request queue (so a homeowner can
-- watch their own request's status), but only Contractor/Developer can move
-- one out of 'pending' — enforced here in RLS, not just the Server Action,
-- since approval is a real authorization boundary (see project_invites'
-- is_developer()-gated policy for the same pattern).
create policy "warranty_item_requests_select" on warranty_item_requests
  for select using (has_project_access(warranty_item_requests.project_id));

create policy "warranty_item_requests_insert" on warranty_item_requests
  for insert with check (has_project_access(warranty_item_requests.project_id) and auth.uid() = requested_by);

create policy "warranty_item_requests_update" on warranty_item_requests
  for update using (
    has_project_access(warranty_item_requests.project_id)
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('contractor', 'developer'))
  );

create policy "warranty_item_requests_delete" on warranty_item_requests
  for delete using (auth.uid() = requested_by);
