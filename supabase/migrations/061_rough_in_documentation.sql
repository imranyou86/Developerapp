-- Rough-In Documentation: before drywall goes up, capture photos/video of
-- a room once framing, rough plumbing, and rough electrical are done — so
-- where the pipes and wires actually run behind the walls isn't lost the
-- moment they're covered up. Useful later for hanging something on a
-- wall, a renovation, or a warranty call. Lives as a new panel on each
-- room's card in Rooms & Tasks (same as the existing rendering/finishes
-- panels) rather than its own tab — no new tab_permissions row needed,
-- gated by the existing 'rooms' tab a role can already see.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-060 applied.

create table if not exists rough_in_captures (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  -- Nullable + a denormalized label (rather than requiring the row to
  -- survive forever) — same reasoning as project_messages.sender_name:
  -- deleting the room later shouldn't blank out a rough-in record's name.
  -- Always set from the room it was captured on, at capture time.
  room_id uuid references rooms (id) on delete set null,
  room_label text not null,
  -- Which of framing/rough plumbing/rough electrical/etc. this walkthrough
  -- covered — free-form enough to add trades later without a migration,
  -- validated in the app rather than a check constraint.
  trades text[] not null default '{}',
  notes text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists rough_in_media (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references rough_in_captures (id) on delete cascade,
  media_type text not null check (media_type in ('photo', 'video')),
  storage_url text not null,
  file_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_rough_in_captures_project on rough_in_captures (project_id, created_at desc);
create index if not exists idx_rough_in_media_capture on rough_in_media (capture_id);

alter table rough_in_captures enable row level security;
alter table rough_in_media enable row level security;

create policy "rough_in_captures_member" on rough_in_captures
  for all using (has_project_access(rough_in_captures.project_id))
  with check (has_project_access(rough_in_captures.project_id));

-- Same join-through-parent shape as checklist_photos_member.
create policy "rough_in_media_member" on rough_in_media
  for all using (exists (select 1 from rough_in_captures c where c.id = rough_in_media.capture_id and has_project_access(c.project_id)))
  with check (exists (select 1 from rough_in_captures c where c.id = rough_in_media.capture_id and has_project_access(c.project_id)));

insert into storage.buckets (id, name, public)
values ('rough-in-media', 'rough-in-media', false)
on conflict (id) do update set public = excluded.public;

create policy "rough_in_media_storage_owner" on storage.objects
  for all using (bucket_id = 'rough-in-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'rough-in-media' and (storage.foldername(name))[1] = auth.uid()::text);

alter table project_files drop constraint if exists project_files_category_check;
alter table project_files add constraint project_files_category_check
  check (category in ('plan', 'bid', 'trade_bid', 'checklist_photo', 'rendering', 'rough_in', 'finish_scan', 'document', 'photo', 'interior_design', 'landscape_design'));

insert into notification_settings (action, enabled, roles) values
  ('rough_in_captured', true, '{}')
on conflict (action) do nothing;
