-- Adds public, read-only project share links: /share/[token] pages that
-- project managers, owners, and other staff can view without an account.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied. Safe to run — it only creates new
-- objects, it doesn't touch anything that already exists.

create table if not exists project_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_project_shares_project on project_shares (project_id);
create index if not exists idx_project_shares_token on project_shares (token);

alter table project_shares enable row level security;

-- Only the project owner can create/list/revoke share links. The public
-- /share/[token] page never queries through the anon key — it looks the
-- token up server-side with the service-role key, which bypasses RLS
-- entirely, so no policy here grants anonymous access.
create policy "project_shares_owner" on project_shares
  for all using (exists (select 1 from projects p where p.id = project_shares.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_shares.project_id and p.user_id = auth.uid()));
