-- Lets whoever rejects a warranty request (Contractor/Developer/PM) leave a
-- reason — shown to the homeowner who filed it, same read/write boundary as
-- every other column on this table (warranty_item_requests_update already
-- covers this, no new policy needed).
alter table warranty_item_requests
  add column if not exists rejection_note text;

-- Groups multiple tasks filed under one trade into a single ticket — e.g.
-- "Electrical" as one request with 4 individual tasks inside it, each
-- approved/rejected on its own, rather than 4 separate requests each
-- needing its own subcontractor/schedule when in practice one electrician
-- visit covers all of them. is_group=true marks the parent row (its own
-- title is the trade/group name, e.g. "Electrical"; its subcontractor_id/
-- scheduled_date/time_start/time_end — already added above — are shared by
-- every task in the group); group_id on a task row points back to its
-- parent and is null for an ordinary standalone single-issue request
-- (unchanged from before this migration). A parent's own status/
-- checklist_item_id/rejection_note/reviewed_by/reviewed_at go unused —
-- only its child tasks carry real triage state — which is why the group
-- "stays" regardless of what happens to any one task inside it.
alter table warranty_item_requests
  add column if not exists is_group boolean not null default false,
  add column if not exists group_id uuid references warranty_item_requests (id) on delete cascade;

create index if not exists idx_warranty_item_requests_group on warranty_item_requests (group_id);

-- Lets a Contractor/Developer/PM file a request with requested_by set to a
-- different user — "on behalf of" a homeowner who doesn't know how to use
-- the form themselves. The app only ever offers this for an actual
-- 'warranty' member of the project (see requireApprover + the
-- project_members lookup in requestWarrantyItems), but the policy itself
-- just requires project access and one of these three roles — same trust
-- boundary these roles already have over every other column on this table.
drop policy if exists "warranty_item_requests_insert" on warranty_item_requests;
create policy "warranty_item_requests_insert" on warranty_item_requests
  for insert with check (
    auth.uid() = requested_by
    or (
      has_project_access(warranty_item_requests.project_id)
      and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('contractor', 'developer', 'pm'))
    )
  );

-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-056 applied.
