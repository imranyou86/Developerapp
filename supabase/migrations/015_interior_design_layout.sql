-- Interior Design's 2D layout editor: drag fixtures/furniture (cabinets,
-- island, toilet, shower, etc.) onto a scaled top-down view of the room,
-- then render from that arrangement. The room photo becomes optional —
-- without one, the design is generated from scratch (room type + style +
-- the laid-out fixtures) instead of edited from an uploaded photo.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migration 014_interior_design.sql applied.

alter table interior_designs add column if not exists layout jsonb not null default '[]'::jsonb;
alter table interior_designs alter column original_photo_url drop not null;
