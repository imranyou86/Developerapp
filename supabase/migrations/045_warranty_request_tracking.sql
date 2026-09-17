-- Turns a warranty_item_requests row into a lightweight ticket, on top of
-- its existing pending/approved/rejected triage gate (approve still
-- promotes it into a real checklist_items row — unchanged): Contractor,
-- Developer, and now PM can track it through to done (a "progress" status
-- separate from the triage decision — "open"/"in_progress"/"complete"),
-- assign a subcontractor to it, and leave running comments/notes on it.
-- The 'warranty' role who filed it stays view-only on all of this — it can
-- watch progress/comments/subcontractor change but never post — and, new
-- here, only ever sees requests it filed itself, not every warranty
-- request on a project it happens to share with other warranty accounts.

alter table warranty_item_requests
  add column if not exists progress text not null default 'open' check (progress in ('open', 'in_progress', 'complete')),
  add column if not exists subcontractor_id uuid references subcontractors (id) on delete set null;

-- Lets the person who filed the request attach supporting evidence
-- directly to it (not just to a checklist item, which doesn't exist until
-- the request is approved) — see addInspectionReport's warrantyItemRequestId
-- parameter in app/projects/[id]/warranty-request/actions.ts.
alter table inspection_reports
  add column if not exists warranty_item_request_id uuid references warranty_item_requests (id) on delete set null;

create table if not exists warranty_item_request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references warranty_item_requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_email text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_warranty_item_request_comments_request on warranty_item_request_comments (request_id, created_at);

alter table warranty_item_request_comments enable row level security;

-- Security definer (same pattern as has_project_access/is_developer, so it
-- can be called from warranty_item_requests' own select policy without
-- recursing back through it): a 'warranty' role only ever sees a request
-- it filed itself; every other role with project access sees all of them.
create or replace function can_view_warranty_request(rid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from warranty_item_requests r
    where r.id = rid
    and has_project_access(r.project_id)
    and (
      r.requested_by = auth.uid()
      or not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'warranty')
    )
  );
$$;

drop policy if exists "warranty_item_requests_select" on warranty_item_requests;
create policy "warranty_item_requests_select" on warranty_item_requests
  for select using (can_view_warranty_request(id));

-- PM added alongside Contractor/Developer — all three can now approve/
-- reject, set progress, and assign a subcontractor (all plain updates to
-- this row).
drop policy if exists "warranty_item_requests_update" on warranty_item_requests;
create policy "warranty_item_requests_update" on warranty_item_requests
  for update using (
    has_project_access(warranty_item_requests.project_id)
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('contractor', 'developer', 'pm'))
  );

create policy "warranty_item_request_comments_select" on warranty_item_request_comments
  for select using (can_view_warranty_request(request_id));

create policy "warranty_item_request_comments_insert" on warranty_item_request_comments
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from warranty_item_requests r
      where r.id = warranty_item_request_comments.request_id
      and has_project_access(r.project_id)
    )
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('contractor', 'developer', 'pm'))
  );

-- No update policy — comments aren't editable, same as project_messages.
create policy "warranty_item_request_comments_delete" on warranty_item_request_comments
  for delete using (auth.uid() = user_id or is_developer());

-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-044 applied.
