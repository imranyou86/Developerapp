-- Alaia Homes Dev — schema + RLS
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists plan_pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  storage_url text not null,
  label text not null,
  sort_order int not null default 0,
  -- A plan set often mixes floor-plan sheets with elevations, sections,
  -- details, and structural/MEP sheets. AI room detection and cost
  -- estimation only need the layout sheets — defaults to true so existing
  -- behavior (send everything) is unchanged until a user narrows it down.
  is_layout boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  type text,
  width numeric,
  depth numeric,
  floor int,
  estimated boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  title text not null,
  due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists budget_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  item text not null,
  budgeted numeric not null default 0,
  actual numeric not null default 0,
  -- Set when this line was auto-created from adding a priced finish (see
  -- addFinish), so deleting that finish also removes the budget line it
  -- generated. Null for lines the user added by hand.
  finish_id uuid references finishes (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists finishes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  name text not null,
  category text not null,
  brand text,
  price numeric,
  created_at timestamptz not null default now()
);

create table if not exists finish_scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  storage_url text not null,
  label text,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists cost_estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  total_sqft numeric,
  stories int,
  quality_tier text,
  cost_tier text,
  cost_per_sqft_low numeric,
  cost_per_sqft_mid numeric,
  cost_per_sqft_high numeric,
  total_cost_low numeric,
  total_cost_mid numeric,
  total_cost_high numeric,
  predicted_cost_per_sqft numeric,
  contingency_pct numeric,
  predicted_total_cost numeric,
  prediction_confidence text,
  prediction_notes text,
  complexity_factors jsonb not null default '[]'::jsonb,
  breakdown jsonb not null default '[]'::jsonb,
  reasoning text,
  created_at timestamptz not null default now()
);

create table if not exists renderings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  style text not null,
  label text,
  colors jsonb not null default '[]'::jsonb,
  description text,
  image_prompt text,
  illustration_svg text,
  uploaded_photo_url text,
  created_at timestamptz not null default now()
);

-- Interior Design tab: an optional photo of an empty/framed room (edited in
-- place by OpenAI's image-edit API) or, with no photo, a from-scratch
-- generation — either way given a style + room type + sizing + a 2D
-- fixture/furniture layout laid out in the UI (array of {id, typeId,
-- label, x, y, width, depth, rotated}, in feet from the room's top-left).
-- room_id is optional — sizing can come from a pre-added room (rooms.id)
-- or be entered manually, so this isn't required to point at one.
create table if not exists interior_designs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  room_id uuid references rooms (id) on delete set null,
  room_type text not null,
  style text not null,
  width numeric,
  depth numeric,
  sqft numeric,
  layout jsonb not null default '[]'::jsonb,
  original_photo_url text,
  generated_image_url text not null,
  prompt text not null,
  created_at timestamptz not null default now()
);

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  phase text not null check (phase in ('rough', 'finish')),
  title text not null,
  done boolean not null default false,
  comment text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists checklist_photos (
  id uuid primary key default gen_random_uuid(),
  checklist_item_id uuid not null references checklist_items (id) on delete cascade,
  storage_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  contractor text not null,
  total_amount numeric not null default 0,
  file_name text,
  file_url text,
  uploaded_at timestamptz not null default now(),
  -- New bids land 'pending' in the Incoming bids review section — only
  -- 'accepted' counts toward payment totals/tracking. 'declined' keeps the
  -- record (for comparison) but hides it from both active lists.
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  -- Cached result of "Evaluate bid" (a web-search-grounded market-price
  -- check) — a bid only ever needs its latest evaluation, so plain columns
  -- are enough; re-evaluating overwrites these rather than keeping history.
  evaluation_verdict text check (evaluation_verdict in ('good_price', 'fair_price', 'high_price')),
  evaluation_confidence text check (evaluation_confidence in ('high', 'medium', 'low')),
  evaluation_market_low numeric,
  evaluation_market_high numeric,
  evaluation_analysis text,
  evaluated_at timestamptz
);

create table if not exists payment_schedule_items (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references bids (id) on delete cascade,
  label text not null,
  amount numeric not null default 0,
  paid boolean not null default false
);

-- Public read-only share links. Anonymous visitors never query this table
-- (or any project table) directly — the /share/[token] page looks it up
-- server-side with the service-role key, so no RLS policy grants anon access.
create table if not exists project_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Deal Finder — pre-acquisition property research, independent of any
-- construction project (a deal only becomes a project once pursued).
create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  address text not null,
  city text,
  state text,
  zip_code text not null,
  list_price numeric,
  beds numeric,
  baths numeric,
  sqft numeric,
  lot_size numeric,
  year_built int,
  listing_url text,
  photo_url text,
  -- Zoning is City of Los Angeles-specific (ZIMAS, zimas.lacity.org has no
  -- public API — entered manually, once per deal). LAMC zoning is more
  -- nuanced than a flat lot-coverage % for every zone (single-family lots
  -- use a sliding-scale Residential Floor Area formula, not a flat %), so
  -- this is a starting-point calculator input, not an authoritative figure.
  zone text,
  lot_coverage_pct numeric,
  status text not null default 'researching' check (status in ('researching', 'pursuing', 'passed', 'converted')),
  project_id uuid references projects (id) on delete set null,
  raw_listing jsonb,
  created_at timestamptz not null default now()
);

create table if not exists deal_analyses (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals (id) on delete cascade,
  scope text not null default 'remodel' check (scope in ('remodel', 'ground_up')),
  scope_description text,
  target_sqft numeric,
  cost_per_sqft numeric not null default 400,
  construction_budget numeric not null,
  current_value_estimate numeric,
  arv_estimate numeric,
  arv_low numeric,
  arv_high numeric,
  total_cost numeric not null,
  estimated_profit numeric,
  profit_margin_pct numeric,
  verdict text not null check (verdict in ('good_deal', 'marginal', 'pass')),
  reasoning text,
  comps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Aggregation layer over every uploaded file across the app (plan pages, bid
-- files, checklist photos, rendering photos, finish scans), kept in sync by
-- the upload/delete server actions in each feature via lib/projectFiles.ts.
-- source_table/source_id identify the originating row 1:1 so a re-upload
-- (replacing a photo) deletes-then-reinserts rather than accumulating stale
-- duplicates. This table is a convenience index, not a second source of
-- truth — the feature tables above remain authoritative for their own data.
-- 'document'/'photo' rows are uploaded directly from the Files tab itself,
-- with no originating feature row — source_table/source_id are null for
-- those (the unique index below treats null/null as distinct every time,
-- so manual uploads are never deduped against each other).
create table if not exists project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  storage_url text not null,
  file_name text not null,
  category text not null check (category in ('plan', 'bid', 'checklist_photo', 'rendering', 'finish_scan', 'document', 'photo', 'interior_design')),
  source_table text,
  source_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

-- Account-level login type. One row per auth user; a trigger on auth.users
-- keeps it populated for new signups (see handle_new_user below).
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'owner' check (role in ('owner', 'pm', 'contractor', 'developer')),
  -- Gates access to the whole app (enforced in middleware.ts): new signups
  -- land here as 'pending' until a Developer approves them from Admin's
  -- "Access requests" section, so creating an account alone never grants
  -- usage. 'rejected' is a permanent-looking decline an admin can still
  -- flip back to 'pending'/'approved' later.
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- Which project tabs each role can see. Developer-editable via the Admin
-- page; Developer itself always has full access regardless of these rows
-- (enforced in the app layer, not just here).
create table if not exists tab_permissions (
  role text not null check (role in ('owner', 'pm', 'contractor', 'developer')),
  tab text not null check (tab in ('plan', 'rooms', 'interior-design', 'finish-id', 'checklist', 'budget', 'cost', 'bids', 'payments', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy')),
  allowed boolean not null default true,
  primary key (role, tab)
);

-- Who has access to a project beyond its owner (projects.user_id), and at
-- what role. Populated by accepting a project_invites row.
create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'pm', 'contractor', 'developer')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

-- Only a Developer can create these (see project_invites_all policy below).
-- The invitee visits /invite/[token] which, once they're signed in with a
-- matching email, creates the project_members row and marks this accepted.
create table if not exists project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'pm', 'contractor', 'developer')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- Shared subcontractor directory — not scoped to a single project, so
-- anyone can look up a vetted sub while working any construction. Any
-- signed-in user can read the whole list (see the RLS policy below); only
-- whoever added an entry, or a Developer, can edit/delete it. Trade,
-- license state, etc. are free text (no fixed lists) rather than enums, on
-- the same "don't lock the user into presets" call made for room styles.
create table if not exists subcontractors (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete cascade,
  company_name text not null,
  contact_name text,
  trade text,
  phone text,
  email text,
  address text,
  license_number text,
  license_state text,
  -- 1-5 stars ("how much do we trust this sub"); 1-4 "$" tier ("how
  -- expensive are they relative to other subs"). Both optional — not every
  -- sub has been used enough to rate yet.
  reliability smallint check (reliability between 1 and 5),
  cost_tier smallint check (cost_tier between 1 and 4),
  notes text,
  created_at timestamptz not null default now()
);

-- Which subs are being used on which construction — many-to-many, since a
-- sub works multiple projects and a project uses multiple subs. Scoped by
-- has_project_access(project_id) rather than the subcontractor's own
-- created_by, so any project member can tag "we're using this sub here"
-- regardless of who originally added the sub to the shared directory.
create table if not exists project_subcontractors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  subcontractor_id uuid not null references subcontractors (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, subcontractor_id)
);

-- One row per project, kept current rather than kept as history — the
-- "Update information" button overwrites this row with a fresh lookup
-- (see app/api/claude/lookup-certificate-of-occupancy) rather than
-- accumulating past checks, since what matters here is the current
-- status. Best-effort AI web search against public records (primarily
-- LADBS), not a live query against the department's own database.
create table if not exists certificate_of_occupancy_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects (id) on delete cascade,
  status text,
  co_number text,
  issued_date text,
  open_clearances jsonb not null default '[]'::jsonb,
  permits jsonb not null default '[]'::jsonb,
  inspector jsonb,
  source_url text,
  confidence text check (confidence in ('high', 'medium', 'low')),
  notes text,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_plan_pages_project on plan_pages (project_id, sort_order);
create index if not exists idx_rooms_project on rooms (project_id);
create index if not exists idx_tasks_room on tasks (room_id);
create index if not exists idx_budget_items_room on budget_items (room_id);
create index if not exists idx_finishes_room on finishes (room_id);
create index if not exists idx_budget_items_finish on budget_items (finish_id);
create index if not exists idx_finish_scans_project on finish_scans (project_id, created_at desc);
create index if not exists idx_cost_estimates_project on cost_estimates (project_id, created_at desc);
create index if not exists idx_renderings_room on renderings (room_id);
create index if not exists idx_interior_designs_project on interior_designs (project_id, created_at desc);
create index if not exists idx_interior_designs_room on interior_designs (room_id);
create index if not exists idx_checklist_items_project on checklist_items (project_id, phase, sort_order);
create index if not exists idx_checklist_photos_item on checklist_photos (checklist_item_id);
create index if not exists idx_bids_project on bids (project_id);
create index if not exists idx_payment_schedule_items_bid on payment_schedule_items (bid_id);
create index if not exists idx_project_shares_project on project_shares (project_id);
create index if not exists idx_project_shares_token on project_shares (token);
create index if not exists idx_deals_user on deals (user_id, created_at desc);
create index if not exists idx_deal_analyses_deal on deal_analyses (deal_id, created_at desc);
create unique index if not exists idx_project_files_source on project_files (source_table, source_id);
create index if not exists idx_project_files_project on project_files (project_id, created_at desc);
create index if not exists idx_project_members_project on project_members (project_id);
create index if not exists idx_project_members_user on project_members (user_id);
create index if not exists idx_project_invites_project on project_invites (project_id, created_at desc);
create index if not exists idx_project_invites_token on project_invites (token);
create index if not exists idx_subcontractors_created_by on subcontractors (created_by);
create index if not exists idx_subcontractors_company_name on subcontractors (company_name);
create index if not exists idx_project_subcontractors_project on project_subcontractors (project_id);
create index if not exists idx_project_subcontractors_sub on project_subcontractors (subcontractor_id);
create index if not exists idx_certificate_of_occupancy_checks_project on certificate_of_occupancy_checks (project_id);

-- Seed the default tab-visibility matrix. Owner/PM/Developer default to
-- every tab (including the top-level Buyers Guide, tab='deals'); Contractor
-- defaults to the field-facing tabs only (no financials/deal analysis, and
-- no sub cost/reliability info) — all Developer-editable afterwards from
-- the Admin page. Certificate of Occupancy defaults visible to everyone,
-- Contractor included — inspection/clearance status is field-relevant
-- info, not a financial tab.
insert into tab_permissions (role, tab, allowed)
select r.role, t.tab, case when r.role = 'contractor' and t.tab in ('interior-design', 'finish-id', 'budget', 'cost', 'bids', 'payments', 'deals', 'subcontractors') then false else true end
from (values ('owner'), ('pm'), ('contractor'), ('developer')) as r(role)
cross join (values ('plan'), ('rooms'), ('interior-design'), ('finish-id'), ('checklist'), ('budget'), ('cost'), ('bids'), ('payments'), ('files'), ('deals'), ('subcontractors'), ('certificate-of-occupancy')) as t(tab)
on conflict (role, tab) do nothing;

-- Backfill a profile for any auth user that predates this table; new
-- signups get one via the trigger below. Pre-existing accounts are
-- grandfathered straight to 'approved' — only signups going through the
-- trigger from here on start out 'pending'.
insert into profiles (id, email, role, status)
select u.id, u.email, 'owner', 'approved'
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

-- A project invite (sent by a Developer via app/projects/[id]/invite-actions.ts,
-- which calls admin.inviteUserByEmail with data: {status: 'approved'}) is
-- already a Developer-vetted grant of access, so those accounts skip the
-- pending queue entirely — only the self-service /login "Create an account"
-- flow (which sets no such metadata) lands someone in 'pending'.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'role', 'owner'),
    case
      when lower(new.email) = 'imranyousuf86@gmail.com' then 'approved'
      when new.raw_user_meta_data ->> 'status' = 'approved' then 'approved'
      else 'pending'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Make imranyousuf86@gmail.com a developer (admin) by default. Safe to re-run.
update profiles set role = 'developer' where lower(email) = 'imranyousuf86@gmail.com';

-- ---------------------------------------------------------------------------
-- Row level security — every row is scoped back to has_project_access(),
-- which grants the project owner, any invited project_members row, or a
-- Developer account.
-- ---------------------------------------------------------------------------

alter table projects enable row level security;
alter table plan_pages enable row level security;
alter table rooms enable row level security;
alter table tasks enable row level security;
alter table budget_items enable row level security;
alter table finishes enable row level security;
alter table finish_scans enable row level security;
alter table cost_estimates enable row level security;
alter table renderings enable row level security;
alter table interior_designs enable row level security;
alter table checklist_items enable row level security;
alter table checklist_photos enable row level security;
alter table bids enable row level security;
alter table payment_schedule_items enable row level security;
alter table project_shares enable row level security;
alter table deals enable row level security;
alter table deal_analyses enable row level security;
alter table project_files enable row level security;
alter table profiles enable row level security;
alter table tab_permissions enable row level security;
alter table project_members enable row level security;
alter table project_invites enable row level security;
alter table subcontractors enable row level security;
alter table project_subcontractors enable row level security;
alter table certificate_of_occupancy_checks enable row level security;

-- security definer so they can be called from other tables' RLS policies
-- without recursing back through THEIR RLS.
create or replace function is_developer()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'developer');
$$;

create or replace function has_project_access(pid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    is_developer()
    or exists (select 1 from projects p where p.id = pid and p.user_id = auth.uid())
    or exists (select 1 from project_members m where m.project_id = pid and m.user_id = auth.uid());
$$;

create policy "projects_select" on projects
  for select using (has_project_access(id));
create policy "projects_insert" on projects
  for insert with check (auth.uid() = user_id);
create policy "projects_update" on projects
  for update using (auth.uid() = user_id or is_developer()) with check (auth.uid() = user_id or is_developer());
create policy "projects_delete" on projects
  for delete using (auth.uid() = user_id or is_developer());

create policy "plan_pages_member" on plan_pages
  for all using (has_project_access(plan_pages.project_id))
  with check (has_project_access(plan_pages.project_id));

create policy "rooms_member" on rooms
  for all using (has_project_access(rooms.project_id))
  with check (has_project_access(rooms.project_id));

create policy "tasks_member" on tasks
  for all using (exists (select 1 from rooms r where r.id = tasks.room_id and has_project_access(r.project_id)))
  with check (exists (select 1 from rooms r where r.id = tasks.room_id and has_project_access(r.project_id)));

create policy "budget_items_member" on budget_items
  for all using (exists (select 1 from rooms r where r.id = budget_items.room_id and has_project_access(r.project_id)))
  with check (exists (select 1 from rooms r where r.id = budget_items.room_id and has_project_access(r.project_id)));

create policy "finishes_member" on finishes
  for all using (exists (select 1 from rooms r where r.id = finishes.room_id and has_project_access(r.project_id)))
  with check (exists (select 1 from rooms r where r.id = finishes.room_id and has_project_access(r.project_id)));

create policy "finish_scans_member" on finish_scans
  for all using (has_project_access(finish_scans.project_id))
  with check (has_project_access(finish_scans.project_id));

create policy "cost_estimates_member" on cost_estimates
  for all using (has_project_access(cost_estimates.project_id))
  with check (has_project_access(cost_estimates.project_id));

create policy "renderings_member" on renderings
  for all using (exists (select 1 from rooms r where r.id = renderings.room_id and has_project_access(r.project_id)))
  with check (exists (select 1 from rooms r where r.id = renderings.room_id and has_project_access(r.project_id)));

create policy "interior_designs_member" on interior_designs
  for all using (has_project_access(interior_designs.project_id))
  with check (has_project_access(interior_designs.project_id));

create policy "checklist_items_member" on checklist_items
  for all using (has_project_access(checklist_items.project_id))
  with check (has_project_access(checklist_items.project_id));

create policy "checklist_photos_member" on checklist_photos
  for all using (exists (select 1 from checklist_items c where c.id = checklist_photos.checklist_item_id and has_project_access(c.project_id)))
  with check (exists (select 1 from checklist_items c where c.id = checklist_photos.checklist_item_id and has_project_access(c.project_id)));

create policy "bids_member" on bids
  for all using (has_project_access(bids.project_id))
  with check (has_project_access(bids.project_id));

create policy "payment_schedule_items_member" on payment_schedule_items
  for all using (exists (select 1 from bids b where b.id = payment_schedule_items.bid_id and has_project_access(b.project_id)))
  with check (exists (select 1 from bids b where b.id = payment_schedule_items.bid_id and has_project_access(b.project_id)));

-- Share links stay owner+developer only. The public /share/[token] page
-- never queries through the anon key — it looks the token up server-side
-- with the service-role key, which bypasses RLS entirely, so no policy
-- here grants anonymous access.
create policy "project_shares_owner" on project_shares
  for all using (exists (select 1 from projects p where p.id = project_shares.project_id and p.user_id = auth.uid()) or is_developer())
  with check (exists (select 1 from projects p where p.id = project_shares.project_id and p.user_id = auth.uid()) or is_developer());

create policy "deals_owner" on deals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "deal_analyses_owner" on deal_analyses
  for all using (exists (select 1 from deals d where d.id = deal_analyses.deal_id and d.user_id = auth.uid()))
  with check (exists (select 1 from deals d where d.id = deal_analyses.deal_id and d.user_id = auth.uid()));

-- Shared directory, unlike deals — any signed-in user can read the whole
-- list (whoever's using the app should be able to look up a sub while
-- bidding out a project), but only whoever added an entry, or a Developer,
-- can change or remove it.
create policy "subcontractors_select" on subcontractors
  for select using (auth.uid() is not null);
create policy "subcontractors_insert" on subcontractors
  for insert with check (auth.uid() = created_by);
create policy "subcontractors_update" on subcontractors
  for update using (auth.uid() = created_by or is_developer()) with check (auth.uid() = created_by or is_developer());
create policy "subcontractors_delete" on subcontractors
  for delete using (auth.uid() = created_by or is_developer());

-- Scoped by project access, not by who added the subcontractor row — any
-- project member can tag a sub as being used on their project.
create policy "project_subcontractors_member" on project_subcontractors
  for all using (has_project_access(project_id)) with check (has_project_access(project_id));

create policy "certificate_of_occupancy_checks_member" on certificate_of_occupancy_checks
  for all using (has_project_access(project_id)) with check (has_project_access(project_id));

create policy "project_files_member" on project_files
  for all using (has_project_access(project_files.project_id))
  with check (has_project_access(project_files.project_id));

create policy "profiles_select" on profiles
  for select using (auth.uid() = id or is_developer());
create policy "profiles_update" on profiles
  for update using (is_developer()) with check (is_developer());

create policy "tab_permissions_select" on tab_permissions
  for select using (auth.uid() is not null);
create policy "tab_permissions_write" on tab_permissions
  for all using (is_developer()) with check (is_developer());

create policy "project_members_select" on project_members
  for select using (has_project_access(project_id));
create policy "project_members_insert" on project_members
  for insert with check (
    is_developer()
    or (
      auth.uid() = user_id
      and exists (
        select 1 from project_invites i
        where i.project_id = project_members.project_id
          and lower(i.email) = lower(auth.email())
          and i.status = 'pending'
      )
    )
  );
create policy "project_members_delete" on project_members
  for delete using (
    is_developer()
    or exists (select 1 from projects p where p.id = project_members.project_id and p.user_id = auth.uid())
  );

-- Only a Developer can create/read/revoke invites — see project_invites_all.
create policy "project_invites_all" on project_invites
  for all using (is_developer()) with check (is_developer());

-- ---------------------------------------------------------------------------
-- Storage buckets — plan pages, rendering photos, checklist photos, bid PDFs,
-- finish-scan photos
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values
  ('plan-pages', 'plan-pages', true),
  ('rendering-photos', 'rendering-photos', true),
  ('checklist-photos', 'checklist-photos', true),
  ('bid-files', 'bid-files', true),
  ('finish-scans', 'finish-scans', true),
  ('project-files', 'project-files', true),
  ('interior-design-photos', 'interior-design-photos', true)
on conflict (id) do nothing;

-- Storage objects are keyed as "<user_id>/<project_id>/<file>" by the app, so a
-- simple "first path segment == auth.uid()" check scopes all storage access.
create policy "plan_pages_storage_owner" on storage.objects
  for all using (bucket_id = 'plan-pages' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'plan-pages' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "rendering_photos_storage_owner" on storage.objects
  for all using (bucket_id = 'rendering-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'rendering-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "checklist_photos_storage_owner" on storage.objects
  for all using (bucket_id = 'checklist-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'checklist-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "bid_files_storage_owner" on storage.objects
  for all using (bucket_id = 'bid-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'bid-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "finish_scans_storage_owner" on storage.objects
  for all using (bucket_id = 'finish-scans' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'finish-scans' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "project_files_storage_owner" on storage.objects
  for all using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "interior_design_photos_storage_owner" on storage.objects
  for all using (bucket_id = 'interior-design-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'interior-design-photos' and (storage.foldername(name))[1] = auth.uid()::text);
