-- House Book tab (per-project): a curated PDF export — the developer picks
-- which layout images, room/finish photos, landscape images, and
-- subcontractors to include, plus an optional AI-written closing note, and
-- it's generated on demand (app/api/projects/[id]/house-book/route.ts).
-- Nothing is persisted for this feature — no new tables — it just needs a
-- tab_permissions row like every other per-project tab.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-025 applied.

alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'checklist', 'budget', 'cost', 'bids', 'payments', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy', 'landscape', 'house-book'));

insert into tab_permissions (role, tab, allowed)
select r.role, 'house-book', case when r.role = 'contractor' then false else true end
from (values ('owner'), ('pm'), ('contractor'), ('developer')) as r(role)
on conflict (role, tab) do nothing;
