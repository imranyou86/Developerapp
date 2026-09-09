-- Opt-in email alerts, one row per (project, subscriber) — a chat message,
-- a checklist/warranty item added or marked fixed, or a warranty item's
-- review status changing all notify every subscriber on that project (see
-- lib/alerts.ts's notifyProjectSubscribers, called from the relevant
-- actions), except whoever caused the change. email is denormalized at
-- subscribe time (from auth.getUser(), not a join) for the same reason
-- project_messages.sender_email is — profiles_select only lets a user read
-- their own profile row, and this needs to read every subscriber's email
-- from a single server-side query when dispatching, not just the caller's.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-032 applied.

create table if not exists project_alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists idx_project_alert_subscriptions_project on project_alert_subscriptions (project_id);

alter table project_alert_subscriptions enable row level security;

drop policy if exists "project_alert_subscriptions_select" on project_alert_subscriptions;
drop policy if exists "project_alert_subscriptions_insert" on project_alert_subscriptions;
drop policy if exists "project_alert_subscriptions_delete" on project_alert_subscriptions;

-- Self-service only — a user manages just their own subscription row, never
-- another member's. Dispatching alerts (reading every subscriber's email
-- for a project at once) happens server-side via the service-role admin
-- client in lib/alerts.ts, which bypasses RLS entirely, so it never needs
-- this policy to allow a broader read.
create policy "project_alert_subscriptions_select" on project_alert_subscriptions
  for select using (auth.uid() = user_id);
create policy "project_alert_subscriptions_insert" on project_alert_subscriptions
  for insert with check (has_project_access(project_id) and auth.uid() = user_id);
create policy "project_alert_subscriptions_delete" on project_alert_subscriptions
  for delete using (auth.uid() = user_id);
