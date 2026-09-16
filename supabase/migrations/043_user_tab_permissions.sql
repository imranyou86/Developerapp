-- Admin portal: create accounts directly (test accounts to try out a
-- role's permissions, or real accounts handed to a specific person)
-- and, per account, override which tabs it can see beyond what its role
-- alone would grant.
--
-- tab_permissions (role, tab, allowed) is a shared matrix — every Owner (or
-- PM, Contractor, ...) gets the same visibility. This table layers a
-- per-user exception on top of that: a row here for (user_id, tab) wins
-- over the role default for that one account only, so a Developer can hand
-- a specific test/managed account a narrower or wider set of tabs without
-- touching the role-wide matrix everyone else relies on. No row for a given
-- tab means "use the role default" — see getAllowedTabSlugs in
-- lib/permissions-server.ts for how the two are merged. A Developer account
-- is always fully allowed regardless of any row here (same invariant as
-- tab_permissions), so this only ever has practical effect for the other
-- roles.
create table if not exists user_tab_permissions (
  user_id uuid not null references auth.users (id) on delete cascade,
  tab text not null check (tab in ('plan', 'rooms', 'interior-design', 'checklist', 'budget', 'cost', 'bids', 'payments', 'bank-transactions', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy', 'landscape', 'house-book', 'chat', 'warranty-request')),
  allowed boolean not null,
  primary key (user_id, tab)
);

alter table user_tab_permissions enable row level security;

-- Tighter than tab_permissions_select (which any signed-in user can read,
-- since it's one shared non-sensitive matrix) — these rows are tied to one
-- specific account, so only that account or a Developer can see them.
create policy "user_tab_permissions_select" on user_tab_permissions
  for select using (auth.uid() = user_id or is_developer());
create policy "user_tab_permissions_write" on user_tab_permissions
  for all using (is_developer()) with check (is_developer());

-- Marks an account created from the Admin portal's "Create account" form
-- for throwaway permission testing, as opposed to a real person's account —
-- purely a label for the Users list (a small "Test" badge) so these are
-- easy to tell apart from real accounts at a glance; it has no effect on
-- access or behavior anywhere else.
alter table profiles add column if not exists is_test boolean not null default false;

-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-042 applied.
