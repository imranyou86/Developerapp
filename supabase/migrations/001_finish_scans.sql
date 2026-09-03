-- Adds the "Finish ID" feature: upload any photo/screenshot and have Claude
-- identify the finishes/materials shown (stone, tile, faucets, paint, etc).
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied. (Safe to run — it only creates
-- new objects, it doesn't touch anything that already exists.)

create table if not exists finish_scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  storage_url text not null,
  label text,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_finish_scans_project on finish_scans (project_id, created_at desc);

alter table finish_scans enable row level security;

create policy "finish_scans_owner" on finish_scans
  for all using (exists (select 1 from projects p where p.id = finish_scans.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = finish_scans.project_id and p.user_id = auth.uid()));

insert into storage.buckets (id, name, public)
values ('finish-scans', 'finish-scans', true)
on conflict (id) do nothing;

create policy "finish_scans_storage_owner" on storage.objects
  for all using (bucket_id = 'finish-scans' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'finish-scans' and (storage.foldername(name))[1] = auth.uid()::text);
