-- Landscape 2D yard layout generator, mirroring Interior Design's room
-- layout editor: a placed-item list plus the yard dimensions it's drawn
-- against. Purely additive — existing rows default to an empty layout with
-- no yard dimensions, and the pre-existing `components` checklist column is
-- left in place (unused going forward, but old designs' data stays intact).
alter table landscape_designs add column if not exists layout jsonb not null default '[]'::jsonb;
alter table landscape_designs add column if not exists yard_width numeric;
alter table landscape_designs add column if not exists yard_depth numeric;
