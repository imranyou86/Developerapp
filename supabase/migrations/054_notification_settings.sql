-- Admin-configurable notification settings: per event ("action"), a
-- Developer can turn the whole notification off, and/or force-notify
-- specific roles regardless of whether that person has personally
-- clicked "Get alerts" on a construction. See lib/notificationCatalog.ts
-- for the canonical list of actions this seeds, and lib/alerts.ts's
-- notifyForAction for how it's read at dispatch time (via the
-- service-role admin client, same as every other alerts.ts query).
--
-- Run this once in the Supabase SQL editor against an EXISTING project
-- that already has migrations 001-053 applied.

create table if not exists notification_settings (
  action text primary key,
  enabled boolean not null default true,
  -- Roles force-notified for this action regardless of individual
  -- "Get alerts" opt-in — empty means purely opt-in, the behavior every
  -- action had before this table existed. No DB-level CHECK on the role
  -- values here (an array CHECK is awkward in Postgres); the Admin action
  -- that writes this validates against ROLE_VALUES instead.
  roles text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table notification_settings enable row level security;

-- Developer-only in both directions — this isn't a per-user preference
-- like project_alert_subscriptions, it's a shared, account-wide policy
-- only the Admin page edits, and dispatch always reads it via the
-- service-role admin client anyway (bypassing RLS), so no other role
-- ever needs read access here.
create policy "notification_settings_select" on notification_settings
  for select using (is_developer());
create policy "notification_settings_write" on notification_settings
  for all using (is_developer()) with check (is_developer());

insert into notification_settings (action, enabled, roles) values
  ('chat_message', true, '{}'),
  ('checklist_item_added', true, '{}'),
  ('checklist_item_done', true, '{}'),
  ('warranty_item_added', true, '{}'),
  ('warranty_item_done', true, '{}'),
  ('warranty_item_status_changed', true, '{}'),
  ('warranty_items_from_report', true, '{}'),
  ('warranty_request_submitted', true, '{contractor,developer}'),
  ('warranty_request_approved', true, '{}'),
  ('warranty_request_rejected', true, '{}'),
  ('warranty_request_status_changed', true, '{}'),
  ('warranty_request_comment', true, '{}')
on conflict (action) do nothing;
