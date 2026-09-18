-- Manually-added calendar items (meetings, site visits, anything that
-- isn't a room task due date or a warranty visit) — shown on /calendar
-- alongside those, visible to anyone with access to that construction.
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  title text not null,
  notes text,
  event_date date not null,
  time_start time,
  time_end time,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_calendar_events_project on calendar_events (project_id, event_date);

alter table calendar_events enable row level security;

-- Same read boundary as everything else scoped to a construction.
create policy "calendar_events_select" on calendar_events
  for select using (has_project_access(project_id));

-- Everyone with access to the construction can add one, except the
-- 'warranty' role — view-only everywhere outside its own request queue,
-- same carve-out as requireCanManageWarrantyItems.
create policy "calendar_events_insert" on calendar_events
  for insert with check (
    has_project_access(project_id)
    and not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'warranty')
  );

-- Only whoever added an item (or a Developer) can edit or remove it.
create policy "calendar_events_update" on calendar_events
  for update using (created_by = auth.uid() or is_developer())
  with check (created_by = auth.uid() or is_developer());

create policy "calendar_events_delete" on calendar_events
  for delete using (created_by = auth.uid() or is_developer());

-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-055 applied.
