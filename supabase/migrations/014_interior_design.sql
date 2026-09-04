-- Interior Design tab: upload a photo of an empty/framed room, pick a
-- style + room type (and sizing from a pre-added room or entered
-- manually), and have OpenAI's image-edit API redesign the actual photo.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-013 applied.

create table if not exists interior_designs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  room_id uuid references rooms (id) on delete set null,
  room_type text not null,
  style text not null,
  width numeric,
  depth numeric,
  sqft numeric,
  original_photo_url text not null,
  generated_image_url text not null,
  prompt text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_interior_designs_project on interior_designs (project_id, created_at desc);
create index if not exists idx_interior_designs_room on interior_designs (room_id);

alter table interior_designs enable row level security;

drop policy if exists "interior_designs_member" on interior_designs;
create policy "interior_designs_member" on interior_designs
  for all using (has_project_access(interior_designs.project_id))
  with check (has_project_access(interior_designs.project_id));

-- Add the new tab to the same Developer-editable visibility matrix as the
-- other project tabs, and the new file category to the File Library.
alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'finish-id', 'checklist', 'budget', 'cost', 'payments', 'files', 'deals'));

insert into tab_permissions (role, tab, allowed)
select r.role, 'interior-design', case when r.role = 'contractor' then false else true end
from (values ('owner'), ('pm'), ('contractor'), ('developer')) as r(role)
on conflict (role, tab) do nothing;

alter table project_files drop constraint if exists project_files_category_check;
alter table project_files add constraint project_files_category_check
  check (category in ('plan', 'bid', 'checklist_photo', 'rendering', 'finish_scan', 'document', 'photo', 'interior_design'));

insert into storage.buckets (id, name, public)
values ('interior-design-photos', 'interior-design-photos', true)
on conflict (id) do nothing;

drop policy if exists "interior_design_photos_storage_owner" on storage.objects;
create policy "interior_design_photos_storage_owner" on storage.objects
  for all using (bucket_id = 'interior-design-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'interior-design-photos' and (storage.foldername(name))[1] = auth.uid()::text);
