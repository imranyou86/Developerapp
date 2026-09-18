-- Web Push subscriptions — one row per browser/device a user has enabled
-- notifications on (a phone and a laptop both subscribing means two rows).
-- Dispatch (lib/webPush.ts, called from lib/alerts.ts alongside the
-- existing email alert) reads these via the service-role admin client, the
-- same way notifyProjectSubscribers already reads project_alert_subscriptions
-- — a push send is a system operation, not something any one caller should
-- read other users' rows through.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-052 applied.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

create policy "push_subscriptions_select" on push_subscriptions
  for select using (auth.uid() = user_id);
create policy "push_subscriptions_insert" on push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy "push_subscriptions_delete" on push_subscriptions
  for delete using (auth.uid() = user_id);
