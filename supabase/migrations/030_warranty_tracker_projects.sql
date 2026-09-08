-- Warranty tracker construction type — for a property that doesn't need the
-- full construction workflow at all (already built elsewhere, or done and
-- only needs its warranty period tracked), created directly as a
-- warranty-only project rather than a Warranty-role user being added to a
-- normal one after the fact. app/projects/[id]/layout.tsx restricts such a
-- project's tabs to just 'warranty-request' for every role, regardless of
-- that role's usual tab_permissions.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-029 applied.

alter table projects add column if not exists kind text not null default 'construction'
  check (kind in ('construction', 'warranty_tracker'));
