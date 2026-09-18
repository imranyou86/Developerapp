-- A 'warranty' account previously only saw a request it filed itself
-- (can_view_warranty_request's requested_by = auth.uid() check) — every
-- other role with project access already saw everything on that
-- construction regardless of who created it. This brings 'warranty' in
-- line with that: visibility is now purely "assigned to this construction",
-- not "this is the specific account that filed it" — so two warranty
-- accounts assigned to the same construction (e.g. a homeowner and a
-- property manager both tracking the same unit) now see the exact same
-- shared queue instead of only their own personal filings.
create or replace function can_view_warranty_request(rid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from warranty_item_requests r
    where r.id = rid
    and has_project_access(r.project_id)
  );
$$;

-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-057 applied.
