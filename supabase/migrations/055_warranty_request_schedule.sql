-- Adds a scheduled visit window to a warranty request — when the assigned
-- subcontractor is expected to show up. Set by whoever manages the request
-- (Contractor/Developer/PM — the existing warranty_item_requests_update RLS
-- policy already covers these columns, no new policy needed) and shown to
-- the homeowner who filed it (app/projects/[id]/warranty-request/) as well
-- as on /calendar, alongside open room task due dates.
alter table warranty_item_requests
  add column if not exists scheduled_date date,
  add column if not exists scheduled_time_start time,
  add column if not exists scheduled_time_end time;

insert into notification_settings (action, enabled, roles) values
  ('warranty_request_scheduled', true, '{}')
on conflict (action) do nothing;

-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-054 applied.
