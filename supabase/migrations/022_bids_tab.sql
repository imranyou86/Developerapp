-- Bids gets split out from Payments into its own project tab: upload,
-- review, evaluate, and accept/decline a contractor bid here — only once
-- accepted does it (and its payment schedule) show up on Payments at all.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migration 021_bid_evaluation.sql applied.

alter table tab_permissions drop constraint if exists tab_permissions_tab_check;
alter table tab_permissions add constraint tab_permissions_tab_check
  check (tab in ('plan', 'rooms', 'interior-design', 'finish-id', 'checklist', 'budget', 'cost', 'bids', 'payments', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy'));

-- Hidden from Contractor by default, same as Payments/Budget — bid pricing
-- is financial info, not field-relevant like Plan/Checklist/C of O.
insert into tab_permissions (role, tab, allowed)
select r.role, 'bids', r.role <> 'contractor'
from (values ('owner'), ('pm'), ('contractor'), ('developer')) as r(role)
on conflict (role, tab) do nothing;
