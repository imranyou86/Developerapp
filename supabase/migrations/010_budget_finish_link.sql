-- Links budget_items back to the finish that generated them, so adding a
-- priced finish to a room automatically creates a matching budget line
-- (see addFinish in app/projects/[id]/rooms/actions.ts), and deleting that
-- finish removes the budget line it created. Manually-added budget items
-- keep finish_id null and are unaffected.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has supabase/schema.sql applied.

alter table budget_items add column if not exists finish_id uuid references finishes (id) on delete cascade;
create index if not exists idx_budget_items_finish on budget_items (finish_id);
