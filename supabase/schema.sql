-- The Developer — schema + RLS
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists plan_pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  storage_url text not null,
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  type text,
  width numeric,
  depth numeric,
  floor int,
  estimated boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  title text not null,
  due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists budget_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  item text not null,
  budgeted numeric not null default 0,
  actual numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists finishes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  name text not null,
  category text not null,
  brand text,
  price numeric,
  created_at timestamptz not null default now()
);

create table if not exists renderings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  style text not null,
  label text,
  colors jsonb not null default '[]'::jsonb,
  description text,
  image_prompt text,
  illustration_svg text,
  uploaded_photo_url text,
  created_at timestamptz not null default now()
);

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  phase text not null check (phase in ('rough', 'finish')),
  title text not null,
  done boolean not null default false,
  comment text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists checklist_photos (
  id uuid primary key default gen_random_uuid(),
  checklist_item_id uuid not null references checklist_items (id) on delete cascade,
  storage_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  contractor text not null,
  total_amount numeric not null default 0,
  file_name text,
  file_url text,
  uploaded_at timestamptz not null default now()
);

create table if not exists payment_schedule_items (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references bids (id) on delete cascade,
  label text not null,
  amount numeric not null default 0,
  paid boolean not null default false
);

create index if not exists idx_plan_pages_project on plan_pages (project_id, sort_order);
create index if not exists idx_rooms_project on rooms (project_id);
create index if not exists idx_tasks_room on tasks (room_id);
create index if not exists idx_budget_items_room on budget_items (room_id);
create index if not exists idx_finishes_room on finishes (room_id);
create index if not exists idx_renderings_room on renderings (room_id);
create index if not exists idx_checklist_items_project on checklist_items (project_id, phase, sort_order);
create index if not exists idx_checklist_photos_item on checklist_photos (checklist_item_id);
create index if not exists idx_bids_project on bids (project_id);
create index if not exists idx_payment_schedule_items_bid on payment_schedule_items (bid_id);

-- ---------------------------------------------------------------------------
-- Row level security — every row is scoped back to projects.user_id = auth.uid()
-- ---------------------------------------------------------------------------

alter table projects enable row level security;
alter table plan_pages enable row level security;
alter table rooms enable row level security;
alter table tasks enable row level security;
alter table budget_items enable row level security;
alter table finishes enable row level security;
alter table renderings enable row level security;
alter table checklist_items enable row level security;
alter table checklist_photos enable row level security;
alter table bids enable row level security;
alter table payment_schedule_items enable row level security;

create policy "projects_owner" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "plan_pages_owner" on plan_pages
  for all using (exists (select 1 from projects p where p.id = plan_pages.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = plan_pages.project_id and p.user_id = auth.uid()));

create policy "rooms_owner" on rooms
  for all using (exists (select 1 from projects p where p.id = rooms.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = rooms.project_id and p.user_id = auth.uid()));

create policy "tasks_owner" on tasks
  for all using (exists (select 1 from rooms r join projects p on p.id = r.project_id where r.id = tasks.room_id and p.user_id = auth.uid()))
  with check (exists (select 1 from rooms r join projects p on p.id = r.project_id where r.id = tasks.room_id and p.user_id = auth.uid()));

create policy "budget_items_owner" on budget_items
  for all using (exists (select 1 from rooms r join projects p on p.id = r.project_id where r.id = budget_items.room_id and p.user_id = auth.uid()))
  with check (exists (select 1 from rooms r join projects p on p.id = r.project_id where r.id = budget_items.room_id and p.user_id = auth.uid()));

create policy "finishes_owner" on finishes
  for all using (exists (select 1 from rooms r join projects p on p.id = r.project_id where r.id = finishes.room_id and p.user_id = auth.uid()))
  with check (exists (select 1 from rooms r join projects p on p.id = r.project_id where r.id = finishes.room_id and p.user_id = auth.uid()));

create policy "renderings_owner" on renderings
  for all using (exists (select 1 from rooms r join projects p on p.id = r.project_id where r.id = renderings.room_id and p.user_id = auth.uid()))
  with check (exists (select 1 from rooms r join projects p on p.id = r.project_id where r.id = renderings.room_id and p.user_id = auth.uid()));

create policy "checklist_items_owner" on checklist_items
  for all using (exists (select 1 from projects p where p.id = checklist_items.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = checklist_items.project_id and p.user_id = auth.uid()));

create policy "checklist_photos_owner" on checklist_photos
  for all using (exists (select 1 from checklist_items c join projects p on p.id = c.project_id where c.id = checklist_photos.checklist_item_id and p.user_id = auth.uid()))
  with check (exists (select 1 from checklist_items c join projects p on p.id = c.project_id where c.id = checklist_photos.checklist_item_id and p.user_id = auth.uid()));

create policy "bids_owner" on bids
  for all using (exists (select 1 from projects p where p.id = bids.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = bids.project_id and p.user_id = auth.uid()));

create policy "payment_schedule_items_owner" on payment_schedule_items
  for all using (exists (select 1 from bids b join projects p on p.id = b.project_id where b.id = payment_schedule_items.bid_id and p.user_id = auth.uid()))
  with check (exists (select 1 from bids b join projects p on p.id = b.project_id where b.id = payment_schedule_items.bid_id and p.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage buckets — plan pages, rendering photos, checklist photos, bid PDFs
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values
  ('plan-pages', 'plan-pages', true),
  ('rendering-photos', 'rendering-photos', true),
  ('checklist-photos', 'checklist-photos', true),
  ('bid-files', 'bid-files', true)
on conflict (id) do nothing;

-- Storage objects are keyed as "<user_id>/<project_id>/<file>" by the app, so a
-- simple "first path segment == auth.uid()" check scopes all storage access.
create policy "plan_pages_storage_owner" on storage.objects
  for all using (bucket_id = 'plan-pages' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'plan-pages' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "rendering_photos_storage_owner" on storage.objects
  for all using (bucket_id = 'rendering-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'rendering-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "checklist_photos_storage_owner" on storage.objects
  for all using (bucket_id = 'checklist-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'checklist-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "bid_files_storage_owner" on storage.objects
  for all using (bucket_id = 'bid-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'bid-files' and (storage.foldername(name))[1] = auth.uid()::text);
