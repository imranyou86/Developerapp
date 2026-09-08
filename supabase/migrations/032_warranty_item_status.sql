-- Warranty item review status — independent of "done" (an item can be
-- validated but not yet fixed, or invalidated and never fixed at all).
-- Rough/finish checklist items never touch this; it just stays 'pending'
-- for them since they have no equivalent review step.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-031 applied.

alter table checklist_items add column if not exists status text not null default 'pending'
  check (status in ('pending', 'validated', 'invalidated'));
