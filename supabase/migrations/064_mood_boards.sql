-- Interior Design: mood boards. Add inspiration photos and material swatch
-- photos for a tracked room, write optional notes on the room's intended
-- look/palette, and compose them into a single collage image — a grid
-- layout generated server-side with sharp (no AI call; see
-- app/api/mood-board/generate), not an AI-reinterpreted image. One board
-- per room (unique on room_id) — adding more items and regenerating
-- updates that same board rather than creating new ones. Lives as a third
-- section on the existing Interior Design top-level tab (same as Finish
-- ID already does), so no new tab_permissions row is needed.
--
-- Run this once in the Supabase SQL editor against an EXISTING project
-- that already has migrations 001-063 applied.

create table if not exists mood_boards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  room_id uuid not null references rooms (id) on delete cascade,
  notes text,
  -- Freeform inspiration photos and material swatches, in board order.
  -- Each item: {id, type: 'inspiration' | 'material', storage_url, label}.
  -- Edited and saved as a whole from the client (same jsonb-array pattern
  -- as interior_designs.layout) rather than a separate per-item table.
  items jsonb not null default '[]'::jsonb,
  -- The generated grid collage combining every item above. Nullable — a
  -- board can have items added before it's ever been generated.
  collage_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id)
);

create index if not exists idx_mood_boards_project on mood_boards (project_id);

alter table mood_boards enable row level security;

create policy "mood_boards_member" on mood_boards
  for all using (has_project_access(mood_boards.project_id))
  with check (has_project_access(mood_boards.project_id));

insert into storage.buckets (id, name, public)
values ('mood-board-photos', 'mood-board-photos', false)
on conflict (id) do update set public = excluded.public;

create policy "mood_board_photos_storage_owner" on storage.objects
  for all using (bucket_id = 'mood-board-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'mood-board-photos' and (storage.foldername(name))[1] = auth.uid()::text);

alter table project_files drop constraint if exists project_files_category_check;
alter table project_files add constraint project_files_category_check
  check (category in ('plan', 'bid', 'trade_bid', 'checklist_photo', 'rendering', 'rough_in', 'finish_scan', 'document', 'photo', 'interior_design', 'landscape_design', 'mood_board'));
