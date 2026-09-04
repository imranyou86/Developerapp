-- Lets files be uploaded directly from the Files tab itself (not just
-- mirrored from another tab's upload), tagged with a category label —
-- Plan, Bid, Document, or Photo. Manual uploads have no originating
-- feature-table row, so source_table/source_id become nullable for them
-- (the existing unique index on (source_table, source_id) treats null/null
-- as distinct every time, so manual uploads never collide with each other).
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied.

alter table project_files alter column source_table drop not null;
alter table project_files alter column source_id drop not null;

alter table project_files drop constraint if exists project_files_category_check;
alter table project_files add constraint project_files_category_check
  check (category in ('plan', 'bid', 'checklist_photo', 'rendering', 'finish_scan', 'document', 'photo'));

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', true)
on conflict (id) do nothing;

create policy "project_files_storage_owner" on storage.objects
  for all using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);
