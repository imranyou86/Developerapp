-- Landscape tab (top-level, next to Construction Cost): upload a photo of
-- the house's exterior, pick a landscape style and which components to add
-- (grass, deck, pool, concrete work, ...), and have OpenAI's image-edit API
-- redesign the actual photo's yard in place.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-024 applied.

create table if not exists landscape_designs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  style text not null,
  components jsonb not null default '[]'::jsonb,
  notes text,
  original_photo_url text not null,
  generated_image_url text not null,
  prompt text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_landscape_designs_project on landscape_designs (project_id, created_at desc);

alter table landscape_designs enable row level security;

drop policy if exists "landscape_designs_member" on landscape_designs;
create policy "landscape_designs_member" on landscape_designs
  for all using (has_project_access(landscape_designs.project_id))
  with check (has_project_access(landscape_designs.project_id));

-- Add the new top-level tab to the same Developer-editable visibility
-- matrix as the other tabs, and the new file category to the File Library.
-- Contractor defaults to hidden, same as Interior Design/Construction Cost.
alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'checklist', 'budget', 'cost', 'bids', 'payments', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy', 'landscape'));

insert into tab_permissions (role, tab, allowed)
select r.role, 'landscape', case when r.role = 'contractor' then false else true end
from (values ('owner'), ('pm'), ('contractor'), ('developer')) as r(role)
on conflict (role, tab) do nothing;

alter table project_files drop constraint if exists project_files_category_check;
alter table project_files add constraint project_files_category_check
  check (category in ('plan', 'bid', 'checklist_photo', 'rendering', 'finish_scan', 'document', 'photo', 'interior_design', 'landscape_design'));

insert into storage.buckets (id, name, public)
values ('landscape-photos', 'landscape-photos', true)
on conflict (id) do nothing;

drop policy if exists "landscape_photos_storage_owner" on storage.objects;
create policy "landscape_photos_storage_owner" on storage.objects
  for all using (bucket_id = 'landscape-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'landscape-photos' and (storage.foldername(name))[1] = auth.uid()::text);
