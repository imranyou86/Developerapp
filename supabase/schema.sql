-- Alaia Homes Dev — schema + RLS
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.
--
-- For an EXISTING project, don't re-run this file — apply the individual
-- files under supabase/migrations/ instead (in filename order), which this
-- file is kept in sync with after every change. `npm run migrate`
-- (scripts/migrate.mjs) applies whichever migration files a project hasn't
-- seen yet, tracked in a `schema_migrations` table, instead of pasting each
-- one into the SQL editor by hand.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  address text,
  -- 'warranty_tracker' is for a property that skips the construction
  -- workflow entirely — already built elsewhere, or done and only needing
  -- its warranty period tracked. app/projects/[id]/layout.tsx restricts
  -- such a project to just the 'warranty-request' tab for every role,
  -- regardless of that role's usual tab_permissions.
  kind text not null default 'construction' check (kind in ('construction', 'warranty_tracker')),
  created_at timestamptz not null default now()
);

-- Construction Cost's "Standalone Plan" mode (a plan not tied to any
-- tracked construction) needs a page that isn't tied to one either, so
-- project_id is optional; created_by backs the RLS for a standalone page,
-- same shape as finish_scans/landscape_designs.
create table if not exists plan_pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
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

-- Finish ID is a universal section (under Interior Design), not a
-- per-project tab — a scan doesn't require picking a construction up front,
-- so project_id is optional; created_by identifies who ran the scan for the
-- RLS below. Individual identified finishes still get attached to a
-- specific construction's room only when the user explicitly sends them
-- there (see addFinish in app/projects/[id]/rooms/actions.ts), unchanged.
create table if not exists finish_scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  storage_url text not null,
  label text,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Optional project_id + created_by, same standalone shape as plan_pages
-- above — an estimate for a plan that isn't (yet, or ever) one of your
-- tracked constructions. title/location give a standalone row something to
-- display in its history in place of a construction's name/address.
create table if not exists cost_estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  title text,
  location text,
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
-- place by Gemini's image-edit call) or, with no photo, a from-scratch
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

-- Landscape tab (top-level, alongside Construction Cost): a required photo
-- of the house's exterior, edited in place by Gemini's image-edit call —
-- unlike Interior Design there's no from-scratch path, since the whole
-- point is redesigning THIS house's actual yard. components is the checked
-- list of landscape elements (array of {id, label, detail}), e.g. grass,
-- deck, pool, concrete work. project_id is optional — a "Standalone
-- Photos" mode lets a design not tied to any tracked construction (a
-- random exterior photo, someone else's listing, etc.); created_by backs
-- the RLS for that case (see below), same shape as finish_scans.
create table if not exists landscape_designs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  style text not null,
  components jsonb not null default '[]'::jsonb,
  notes text,
  original_photo_url text not null,
  generated_image_url text not null,
  prompt text not null,
  layout jsonb not null default '[]'::jsonb,
  yard_width numeric,
  yard_depth numeric,
  created_at timestamptz not null default now()
);

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  -- 'warranty' items are filed by a Warranty-role homeowner post-completion
  -- (app/projects/[id]/warranty-request/) rather than seeded QA steps —
  -- same shape (title/done/comment/photos), just rendered on their own tab.
  phase text not null check (phase in ('rough', 'finish', 'warranty')),
  title text not null,
  done boolean not null default false,
  -- Warranty-only review status, independent of "done" (an item can be
  -- validated but not yet fixed, or invalidated and never fixed at all).
  -- Rough/finish items never touch this — it just stays 'pending' for them.
  status text not null default 'pending' check (status in ('pending', 'validated', 'invalidated')),
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

-- Inspection report uploads (Warranty Request tab) — any file type (PDF,
-- photos, scans), stored in the same 'project-files' bucket the Files tab
-- uses. checklist_item_id starts null (just uploaded, not yet tied to a
-- specific issue) and can be set/cleared afterward to attach the same
-- report to one warranty checklist item; "on delete set null" means
-- deleting that checklist item detaches the report rather than deleting it.
create table if not exists inspection_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  checklist_item_id uuid references checklist_items (id) on delete set null,
  file_name text not null,
  storage_url text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The Warranty role can't add a warranty checklist item directly (see the
-- app-layer role guard in app/projects/[id]/warranty-request/actions.ts) —
-- they file a request here instead, which a Contractor or Developer
-- approves (creating the real checklist_items row, phase='warranty', and
-- linking it back via checklist_item_id) or rejects. Anyone with project
-- access can see the queue (so a homeowner can watch their own request's
-- status), but only Contractor/Developer can move it out of 'pending' —
-- enforced in RLS itself (see the update policy below), not just the
-- action, since approval is a real authorization boundary.
create table if not exists warranty_item_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  title text not null,
  comment text,
  -- Fixed option list (lib/warrantyRequestCategories.ts), enforced only at
  -- the UI layer — same "plain text, no DB check constraint" choice as
  -- bank_transactions.category.
  category text,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Separate from `status` above: `status` is the triage decision (does
  -- this become a real checklist item at all); `progress` is Contractor/
  -- Developer/PM tracking the actual work on it through to done, and
  -- moves independently of (and usually after) that decision.
  progress text not null default 'open' check (progress in ('open', 'in_progress', 'complete')),
  -- subcontractor_id is added via `alter table` further down, after the
  -- `subcontractors` table it references is defined — this table is
  -- created earlier in the file, so an inline FK here would fail on a
  -- fresh install.
  checklist_item_id uuid references checklist_items (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  -- When the assigned subcontractor is expected to show up — set by
  -- whoever manages the request, shown to the homeowner who filed it and
  -- surfaced on /calendar.
  scheduled_date date,
  scheduled_time_start time,
  scheduled_time_end time,
  -- Set when a Contractor/Developer/PM rejects the request — shown to the
  -- homeowner who filed it.
  rejection_note text,
  -- Groups multiple tasks filed under one trade into a single ticket (e.g.
  -- "Electrical" with 4 tasks inside it, each approved/rejected on its own,
  -- sharing one subcontractor/schedule instead of needing 4 separate
  -- requests) — see migration 057 for the full reasoning. is_group=true
  -- marks a parent row; group_id on a task row points back to its parent
  -- and stays null for an ordinary standalone single-issue request.
  is_group boolean not null default false,
  group_id uuid references warranty_item_requests (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- A running comment/notes thread Contractor/Developer/PM keep on a
-- warranty request — the 'warranty' role who filed it can watch this
-- change but never post (see the insert policy below). sender_email is
-- denormalized at write time for the same reason project_messages.sender_email
-- is — profiles_select only lets a user read their own profile row.
create table if not exists warranty_item_request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references warranty_item_requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_email text not null,
  -- Denormalized display name at write time, same reasoning as
  -- sender_email (profiles_select only lets a user read their own row) —
  -- falls back to sender_email in the UI when null.
  sender_name text,
  body text not null,
  created_at timestamptz not null default now()
);

-- Added here rather than inline on inspection_reports' own `create table`
-- above, since warranty_item_requests doesn't exist yet at that point in
-- this file. Lets whoever filed the request attach supporting evidence
-- directly to it (not just to a checklist item, which doesn't exist until
-- the request is approved).
alter table inspection_reports
  add column if not exists warranty_item_request_id uuid references warranty_item_requests (id) on delete set null;

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

-- Bank Transactions tab: rows imported from a bank-exported CSV (parsed
-- client-side, lib/bankCsv.ts — deterministic, no AI call needed for
-- structured tabular data), each optionally linked to a bid so "how much
-- has actually been paid toward this bid" can be tracked. Manual entries
-- (anything that never hits the bank statement — a cash payment, a cost
-- folded into closing that the statement doesn't itemize, etc., for tax-prep
-- purposes) are just ordinary rows here with source_file_name left null.
-- `category` groups rows for the Profit & Loss statement (lib/bankCategories.ts).
-- `include_in_pl` is the actual P&L gate — not every bank-feed debit is a
-- real expense (a transfer between accounts, a loan principal payment,
-- etc.), so the P&L only sums rows explicitly marked in (per-row, or a bulk
-- action over a filtered/selected set), rather than everything imported.
create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  bid_id uuid references bids (id) on delete set null,
  txn_date date not null,
  description text not null,
  amount numeric not null,
  type text not null check (type in ('debit', 'credit')),
  category text,
  include_in_pl boolean not null default false,
  source_file_name text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Re-importing the same statement (overlapping date ranges are common)
-- silently no-ops instead of duplicating rows — see the ignoreDuplicates
-- upsert in app/projects/[id]/bank-transactions/actions.ts.
create unique index if not exists idx_bank_transactions_dedupe on bank_transactions (project_id, txn_date, description, amount, type);

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
  category text not null check (category in ('plan', 'bid', 'trade_bid', 'checklist_photo', 'rendering', 'finish_scan', 'document', 'photo', 'interior_design', 'landscape_design')),
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
  -- 'warranty' is a homeowner given access once their construction is
  -- complete — account-wide (like every other role here), tab_permissions
  -- restricts it to seeing only the 'warranty-request' and 'chat' tabs (see
  -- the seed insert below).
  role text not null default 'owner' check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty')),
  -- Gates access to the whole app (enforced in middleware.ts): new signups
  -- land here as 'pending' until a Developer approves them from Admin's
  -- "Access requests" section, so creating an account alone never grants
  -- usage. 'rejected' is a permanent-looking decline an admin can still
  -- flip back to 'pending'/'approved' later.
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Set by the Admin portal's "Create account" form for a throwaway account
  -- made to try out a role's permissions, as opposed to a real person's
  -- account — purely a label (a small "Test" badge in the Users list), no
  -- effect on access or behavior anywhere else.
  is_test boolean not null default false,
  -- Developer-set friendly name shown in chat and warranty-request comments
  -- instead of the raw email — nullable, falls back to email wherever
  -- unset (see project_messages/warranty_item_request_comments below).
  display_name text,
  created_at timestamptz not null default now()
);

-- Which project tabs each role can see. Developer-editable via the Admin
-- page; Developer itself always has full access regardless of these rows
-- (enforced in the app layer, not just here).
create table if not exists tab_permissions (
  role text not null check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty')),
  tab text not null check (tab in ('plan', 'rooms', 'interior-design', 'checklist', 'budget', 'cost', 'bids', 'payments', 'bank-transactions', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy', 'landscape', 'house-book', 'chat', 'warranty-request', 'activity')),
  allowed boolean not null default true,
  primary key (role, tab)
);

-- Per-account exception on top of the role-wide matrix above — a row here
-- for (user_id, tab) wins over that role's tab_permissions default for
-- this one account only. Lets a Developer hand a specific account (a test
-- account created to try out a role's permissions, or a real account
-- given to a specific person) a narrower or wider tab set without
-- affecting every other account of that role. No row for a tab means "use
-- the role default" (see getAllowedTabSlugs in lib/permissions-server.ts).
-- A Developer account is always fully allowed regardless of any row here,
-- same invariant as tab_permissions.
create table if not exists user_tab_permissions (
  user_id uuid not null references auth.users (id) on delete cascade,
  tab text not null check (tab in ('plan', 'rooms', 'interior-design', 'checklist', 'budget', 'cost', 'bids', 'payments', 'bank-transactions', 'files', 'deals', 'subcontractors', 'certificate-of-occupancy', 'landscape', 'house-book', 'chat', 'warranty-request', 'activity')),
  allowed boolean not null,
  primary key (user_id, tab)
);

-- Who has access to a project beyond its owner (projects.user_id), and at
-- what role. Populated by accepting a project_invites row.
create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty')),
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
  role text not null check (role in ('owner', 'pm', 'contractor', 'developer', 'warranty')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- Chat tab: one running thread per construction, visible to everyone with
-- access to that project (owner, invited project_members, Developer) —
-- same has_project_access() gate as every other per-project table. Kept
-- deliberately simple for a first pass: no threads/channels, no edit, no
-- attachments — just messages, in order, with a way to remove your own.
-- sender_email is denormalized at write time (from auth.getUser(), not a
-- join) deliberately — profiles_select only lets a user read their own
-- profile row, so a co-member's email couldn't be resolved for display via
-- a profiles join without loosening that policy app-wide. Storing it on
-- the message avoids needing to at all.
create table if not exists project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_email text not null,
  -- Denormalized display name at write time, same reasoning as
  -- sender_email (profiles_select only lets a user read their own row) —
  -- falls back to sender_email in the UI when null.
  sender_name text,
  body text not null,
  created_at timestamptz not null default now()
);

-- Tracks the last time each member read a given construction's chat, so the
-- tab strip (app/projects/[id]/project-tabs.tsx) can show an unread-count
-- badge on "Chat" — one row per (project, user), upserted to now() whenever
-- that user is actively viewing the chat page (markChatRead in
-- app/projects/[id]/chat/actions.ts). No row yet means "never read this
-- project's chat," so every existing message counts as unread the first
-- time, same as most chat apps.
create table if not exists project_chat_reads (
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Scoped chat threads — alongside the project-wide General chat above (the
-- default, unchanged), a Developer/Contractor/PM can start a named thread
-- with just a subset of the team (typically: themselves, the owner, and
-- one subcontractor account on the project). See migration 060.
create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists chat_thread_participants (
  thread_id uuid not null references chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (thread_id, user_id)
);

-- Same shape as project_chat_reads, scoped to a thread instead of a whole
-- project.
create table if not exists chat_thread_reads (
  thread_id uuid not null references chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- Null means "the project-wide General chat" (project_messages' original
-- behavior); set means this message belongs to one scoped thread instead
-- and only that thread's participants can see it (see the
-- project_messages_select/insert policies below).
alter table project_messages add column if not exists thread_id uuid references chat_threads (id) on delete cascade;

-- Opt-in email alerts, one row per (project, subscriber) — a chat message,
-- a checklist/warranty item added or marked fixed, or a warranty item's
-- review status changing all notify every subscriber on that project (see
-- lib/alerts.ts's notifyProjectSubscribers, called from the relevant
-- actions), except whoever caused the change. email is denormalized at
-- subscribe time (from auth.getUser(), not a join) for the same reason
-- project_messages.sender_email is — profiles_select only lets a user read
-- their own profile row, and this needs to read every subscriber's email
-- from a single server-side query when dispatching, not just the caller's.
create table if not exists project_alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

-- Web Push subscriptions — one row per browser/device a user has enabled
-- notifications on. Dispatch (lib/webPush.ts, called from lib/alerts.ts
-- alongside the existing email alert) reads these via the service-role
-- admin client, same reasoning as project_alert_subscriptions above.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);

-- Admin-configurable notification settings — see lib/notificationCatalog.ts
-- for the canonical action list this is seeded from below, and
-- lib/alerts.ts's notifyForAction for how it's read at dispatch time.
create table if not exists notification_settings (
  action text primary key,
  enabled boolean not null default true,
  -- Roles force-notified for this action regardless of individual
  -- "Get alerts" opt-in — empty means purely opt-in. No DB-level CHECK on
  -- the role values (an array CHECK is awkward in Postgres); the Admin
  -- action that writes this validates against ROLE_VALUES instead.
  roles text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Manually-added calendar items (meetings, site visits, anything that
-- isn't a room task due date or a warranty visit) — shown on /calendar
-- alongside those, visible to anyone with access to that construction.
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  title text not null,
  notes text,
  event_date date not null,
  time_start time,
  time_end time,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_calendar_events_project on calendar_events (project_id, event_date);

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
  -- Set manually after checking the license on CSLB (see the "Check on
  -- CSLB" link next to the license fields) — no public API to pull this
  -- automatically, same reasoning as Certificate of Occupancy's manual
  -- findings entry. license_checked_at is stamped whenever license_status
  -- is (re)saved non-empty.
  license_status text,
  license_checked_at timestamptz,
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

-- Added here (rather than inline on warranty_item_requests' own `create
-- table` above) since `subcontractors` doesn't exist yet at that point in
-- this file. Who a Contractor/Developer/PM has assigned to actually fix a
-- warranty request, picked from this project's own linked subcontractors.
alter table warranty_item_requests
  add column if not exists subcontractor_id uuid references subcontractors (id) on delete set null;

-- Construction Cost's "Trade Bid Review" section — separate from the Bids
-- tab's whole-contract/GC bids (which track a payment draw schedule through
-- to Payments once accepted). This is a lighter-weight record: one
-- subcontractor's bid for one trade, evaluated for price fairness, scope
-- completeness, and good clarifying questions to ask before signing — never
-- flows into Payments itself. Placed here (not with `bids` above) since it
-- references `subcontractors`, defined just above this point.
create table if not exists trade_bid_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  trade text not null,
  subcontractor_name text not null,
  subcontractor_id uuid references subcontractors (id) on delete set null,
  bid_amount numeric not null default 0,
  -- What the sub says is included — pasted in or typed by whoever's
  -- reviewing it, since a subcontractor bid's scope rarely comes as a
  -- clean payment schedule the way extract-bid's GC bids do.
  scope_notes text,
  file_name text,
  file_url text,
  -- Cached result of "Evaluate" (web-search-grounded price/scope check) —
  -- same "plain columns, latest evaluation wins, re-evaluating overwrites"
  -- pattern as bids.evaluation_*.
  evaluation_verdict text check (evaluation_verdict in ('good_price', 'fair_price', 'high_price')),
  evaluation_confidence text check (evaluation_confidence in ('high', 'medium', 'low')),
  evaluation_market_low numeric,
  evaluation_market_high numeric,
  evaluation_analysis text,
  evaluation_questions jsonb not null default '[]'::jsonb,
  evaluation_scope_complete boolean,
  evaluation_missing_items jsonb not null default '[]'::jsonb,
  evaluation_completeness_note text,
  evaluated_at timestamptz,
  created_at timestamptz not null default now()
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

-- Cost/abuse guard for the paid AI routes (see lib/rateLimit.ts) — one row
-- per request that passed auth, so a per-user, per-route count over a
-- rolling window can cap how often an expensive route (image generation,
-- web-search-grounded estimates) can be called. No RLS policies at all
-- (just RLS enabled below) — only ever read/written via the service-role
-- admin client, same as project_alert_subscriptions' dispatch path.
create table if not exists api_rate_limit_hits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  route text not null,
  created_at timestamptz not null default now()
);

-- Append-only audit trail for the highest-value "who did that?" moments —
-- see lib/activityLog.ts for exactly which actions write here (not every
-- mutation in the app is logged). Deliberately no update/delete policy —
-- only select/insert below — an audit log editable or erasable by its own
-- author isn't an audit log. Note: deleting the construction itself isn't
-- logged here, since project_id cascades on delete and would take its own
-- log entries down with it.
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  -- Denormalized display name/email at write time (see lib/activityLog.ts)
  -- — profiles_select only lets a user read their own row, so the
  -- per-project Activity tab can't resolve another member's name via a
  -- live join.
  actor_name text,
  action text not null,
  entity_type text,
  entity_id text,
  detail text,
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
create index if not exists idx_landscape_designs_project on landscape_designs (project_id, created_at desc);
create index if not exists idx_checklist_items_project on checklist_items (project_id, phase, sort_order);
create index if not exists idx_checklist_photos_item on checklist_photos (checklist_item_id);
create index if not exists idx_inspection_reports_project on inspection_reports (project_id, created_at desc);
create index if not exists idx_inspection_reports_checklist_item on inspection_reports (checklist_item_id);
create index if not exists idx_warranty_item_requests_project on warranty_item_requests (project_id, status, created_at);
create index if not exists idx_warranty_item_requests_group on warranty_item_requests (group_id);
create index if not exists idx_bids_project on bids (project_id);
create index if not exists idx_payment_schedule_items_bid on payment_schedule_items (bid_id);
create index if not exists idx_trade_bid_reviews_project on trade_bid_reviews (project_id, created_at desc);
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
create index if not exists idx_project_messages_project on project_messages (project_id, created_at);
create index if not exists idx_chat_threads_project on chat_threads (project_id, created_at desc);
create index if not exists idx_chat_thread_participants_user on chat_thread_participants (user_id);
create index if not exists idx_project_messages_thread on project_messages (thread_id, created_at);
create index if not exists idx_project_alert_subscriptions_project on project_alert_subscriptions (project_id);
create index if not exists idx_push_subscriptions_user on push_subscriptions (user_id);
create index if not exists idx_subcontractors_created_by on subcontractors (created_by);
create index if not exists idx_subcontractors_company_name on subcontractors (company_name);
create index if not exists idx_project_subcontractors_project on project_subcontractors (project_id);
create index if not exists idx_project_subcontractors_sub on project_subcontractors (subcontractor_id);
create index if not exists idx_certificate_of_occupancy_checks_project on certificate_of_occupancy_checks (project_id);
create index if not exists idx_api_rate_limit_hits_user_route on api_rate_limit_hits (user_id, route, created_at);
create index if not exists idx_activity_log_project on activity_log (project_id, created_at desc);
create index if not exists idx_bank_transactions_project on bank_transactions (project_id, txn_date desc);
create index if not exists idx_bank_transactions_bid on bank_transactions (bid_id);

-- Seed the default tab-visibility matrix. Owner/PM/Developer default to
-- every tab (including the top-level Buyers Guide, tab='deals'); Contractor
-- defaults to the field-facing tabs only (no financials/deal analysis, and
-- no sub cost/reliability info) — all Developer-editable afterwards from
-- the Admin page. Certificate of Occupancy and Chat default visible to
-- everyone, Contractor included — clearance status and team communication
-- are both field-relevant, not financial tabs. Warranty is the exception
-- shape: rather than losing a few tabs like Contractor, it loses every tab
-- EXCEPT warranty-request and chat — that account can file/track warranty
-- requests and talk to the team about them, but sees nothing else, on any
-- construction it can reach. It's also view-only on warranty-request itself
-- (enforced app-side, not here — see the role guard in
-- app/projects/[id]/warranty-request/actions.ts): it can watch checklist
-- items and notes and request new ones, but can't mark items done, change
-- status, or delete anything without a Contractor/Developer approving.
insert into tab_permissions (role, tab, allowed)
select r.role, t.tab, case
  when r.role = 'warranty' and t.tab not in ('warranty-request', 'chat') then false
  when r.role = 'contractor' and t.tab in ('interior-design', 'budget', 'cost', 'bids', 'payments', 'bank-transactions', 'deals', 'subcontractors', 'landscape', 'house-book') then false
  else true
end
from (values ('owner'), ('pm'), ('contractor'), ('developer'), ('warranty')) as r(role)
cross join (values ('plan'), ('rooms'), ('interior-design'), ('checklist'), ('budget'), ('cost'), ('bids'), ('payments'), ('bank-transactions'), ('files'), ('deals'), ('subcontractors'), ('certificate-of-occupancy'), ('landscape'), ('house-book'), ('chat'), ('warranty-request'), ('activity')) as t(tab)
on conflict (role, tab) do nothing;

-- Seeded from lib/notificationCatalog.ts — keep these two in sync.
insert into notification_settings (action, enabled, roles) values
  ('chat_message', true, '{}'),
  ('checklist_item_added', true, '{}'),
  ('checklist_item_done', true, '{}'),
  ('warranty_item_added', true, '{}'),
  ('warranty_item_done', true, '{}'),
  ('warranty_item_status_changed', true, '{}'),
  ('warranty_items_from_report', true, '{}'),
  ('warranty_request_submitted', true, '{contractor,developer}'),
  ('warranty_request_approved', true, '{}'),
  ('warranty_request_rejected', true, '{}'),
  ('warranty_request_status_changed', true, '{}'),
  ('warranty_request_comment', true, '{}'),
  ('warranty_request_scheduled', true, '{}')
on conflict (action) do nothing;

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
alter table landscape_designs enable row level security;
alter table checklist_items enable row level security;
alter table checklist_photos enable row level security;
alter table inspection_reports enable row level security;
alter table warranty_item_requests enable row level security;
alter table warranty_item_request_comments enable row level security;
alter table bids enable row level security;
alter table payment_schedule_items enable row level security;
alter table trade_bid_reviews enable row level security;
alter table project_shares enable row level security;
alter table deals enable row level security;
alter table deal_analyses enable row level security;
alter table project_files enable row level security;
alter table profiles enable row level security;
alter table tab_permissions enable row level security;
alter table project_members enable row level security;
alter table project_invites enable row level security;
alter table project_messages enable row level security;
alter table project_chat_reads enable row level security;
alter table chat_threads enable row level security;
alter table chat_thread_participants enable row level security;
alter table chat_thread_reads enable row level security;
alter table user_tab_permissions enable row level security;
alter table project_alert_subscriptions enable row level security;
alter table push_subscriptions enable row level security;
alter table notification_settings enable row level security;
alter table calendar_events enable row level security;
alter table subcontractors enable row level security;
alter table project_subcontractors enable row level security;
alter table certificate_of_occupancy_checks enable row level security;
alter table api_rate_limit_hits enable row level security;
alter table activity_log enable row level security;
alter table bank_transactions enable row level security;

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

create or replace function is_thread_participant(tid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_developer() or exists (
    select 1 from chat_thread_participants p where p.thread_id = tid and p.user_id = auth.uid()
  );
$$;

-- Only Developer/Contractor/PM project members can start a thread — Owner
-- and Warranty accounts can be included as participants but don't get the
-- "+ New thread" option themselves.
create or replace function can_create_chat_thread(pid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select has_project_access(pid) and exists (
    select 1 from profiles where id = auth.uid() and role in ('developer', 'contractor', 'pm')
  );
$$;

-- Security definer so it can be called from warranty_item_requests' own
-- select policy without recursing back through it. Visibility is purely
-- "assigned to this construction" (has_project_access) — same boundary
-- every other role already has — not "this is the specific account that
-- filed it" (see migration 058): two 'warranty' accounts on the same
-- construction see the exact same shared queue.
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

-- Only a Developer or Contractor can create/edit/delete a construction
-- record itself (see can_manage_projects() below) — every other role can
-- still be a project_member and use whatever tabs it's allowed, just not
-- manage the construction record.
create or replace function can_manage_projects()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('developer', 'contractor'));
$$;

create policy "projects_select" on projects
  for select using (has_project_access(id));
create policy "projects_insert" on projects
  -- No has_project_access(id) here — the row doesn't exist yet, so there's
  -- nothing to have "access" to until after it's created.
  for insert with check (auth.uid() = user_id and can_manage_projects());
create policy "projects_update" on projects
  for update using (can_manage_projects() and has_project_access(id)) with check (can_manage_projects() and has_project_access(id));
create policy "projects_delete" on projects
  for delete using (can_manage_projects() and has_project_access(id));

-- Project-tied pages stay gated by project membership. Unlike Landscape's
-- "Standalone Photos" (a shared directory of one-off reference images), a
-- standalone plan (project_id null) is a private multi-page working set —
-- visible only to its own creator (or a Developer).
create policy "plan_pages_select" on plan_pages
  for select using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
create policy "plan_pages_insert" on plan_pages
  for insert with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and auth.uid() = created_by)
  );
create policy "plan_pages_update" on plan_pages
  for update using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  ) with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
create policy "plan_pages_delete" on plan_pages
  for delete using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );

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

-- Finish ID is universal (not project-scoped) — same shared-directory shape
-- as subcontractors below: any signed-in user can see every scan, but only
-- its own creator (or a Developer) can change or remove it.
create policy "finish_scans_select" on finish_scans
  for select using (auth.uid() is not null);
create policy "finish_scans_insert" on finish_scans
  for insert with check (auth.uid() = created_by);
create policy "finish_scans_update" on finish_scans
  for update using (auth.uid() = created_by or is_developer()) with check (auth.uid() = created_by or is_developer());
create policy "finish_scans_delete" on finish_scans
  for delete using (auth.uid() = created_by or is_developer());

-- Same reasoning as plan_pages_select above — private to its own creator.
create policy "cost_estimates_select" on cost_estimates
  for select using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
create policy "cost_estimates_insert" on cost_estimates
  for insert with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and auth.uid() = created_by)
  );
create policy "cost_estimates_update" on cost_estimates
  for update using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  ) with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
create policy "cost_estimates_delete" on cost_estimates
  for delete using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );

create policy "renderings_member" on renderings
  for all using (exists (select 1 from rooms r where r.id = renderings.room_id and has_project_access(r.project_id)))
  with check (exists (select 1 from rooms r where r.id = renderings.room_id and has_project_access(r.project_id)));

create policy "interior_designs_member" on interior_designs
  for all using (has_project_access(interior_designs.project_id))
  with check (has_project_access(interior_designs.project_id));

-- Project-tied rows stay gated by project membership; a "Standalone
-- Photos" row (project_id null) is a shared-directory row instead — any
-- signed-in user can see it, only its creator (or a Developer) can change
-- or remove it — same shape as the shared finish_scans/subcontractors
-- directories.
create policy "landscape_designs_select" on landscape_designs
  for select using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and auth.uid() is not null)
  );
create policy "landscape_designs_insert" on landscape_designs
  for insert with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and auth.uid() = created_by)
  );
create policy "landscape_designs_update" on landscape_designs
  for update using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  ) with check (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );
create policy "landscape_designs_delete" on landscape_designs
  for delete using (
    (project_id is not null and has_project_access(project_id))
    or (project_id is null and (auth.uid() = created_by or is_developer()))
  );

create policy "checklist_items_member" on checklist_items
  for all using (has_project_access(checklist_items.project_id))
  with check (has_project_access(checklist_items.project_id));

create policy "checklist_photos_member" on checklist_photos
  for all using (exists (select 1 from checklist_items c where c.id = checklist_photos.checklist_item_id and has_project_access(c.project_id)))
  with check (exists (select 1 from checklist_items c where c.id = checklist_photos.checklist_item_id and has_project_access(c.project_id)));

create policy "inspection_reports_member" on inspection_reports
  for all using (has_project_access(inspection_reports.project_id))
  with check (has_project_access(inspection_reports.project_id));

-- A 'warranty' role only sees a request it filed itself (can_view_warranty_request);
-- every other role with project access sees the whole queue (so Contractor/
-- Developer/PM triage it, and a co-owner can follow along too). Only
-- Contractor/Developer/PM can move one out of 'pending' or change its
-- progress/subcontractor — enforced here in RLS, not just the Server
-- Action, since approval is a real authorization boundary (see
-- project_invites' is_developer()-gated policy for the same pattern).
create policy "warranty_item_requests_select" on warranty_item_requests
  for select using (can_view_warranty_request(id));

-- Self-filing (auth.uid() = requested_by) needs no has_project_access()
-- check (see migration 048) — extensively verified correct in isolation,
-- but real inserts kept failing with the same RLS violation across
-- multiple accounts with no root cause found, so that check was dropped
-- for this branch specifically; requested_by still has to be the filer's
-- own id, so no one can pretend to be another account this way.
-- The second branch (migration 057) is the one deliberate exception: a
-- Contractor/Developer/PM with project access can set requested_by to a
-- different user, to file "on behalf of" a homeowner who doesn't know how
-- to use the form themselves (see requestWarrantyItems' onBehalfOfUserId).
create policy "warranty_item_requests_insert" on warranty_item_requests
  for insert with check (
    auth.uid() = requested_by
    or (
      has_project_access(warranty_item_requests.project_id)
      and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('contractor', 'developer', 'pm'))
    )
  );

create policy "warranty_item_requests_update" on warranty_item_requests
  for update using (
    has_project_access(warranty_item_requests.project_id)
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('contractor', 'developer', 'pm'))
  );

-- The account that filed it can delete its own; Contractor/Developer can
-- also delete any request outright (see migration 049) — a stronger
-- action than reject, which just flips status and keeps the row.
create policy "warranty_item_requests_delete" on warranty_item_requests
  for delete using (
    auth.uid() = requested_by
    or (
      has_project_access(project_id)
      and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('contractor', 'developer'))
    )
  );

-- A running comment/notes thread — visible to whoever can see the request
-- itself (can_view_warranty_request, same "warranty sees only its own"
-- restriction), but only Contractor/Developer/PM can post; no update
-- policy, comments aren't editable, same as project_messages.
create policy "warranty_item_request_comments_select" on warranty_item_request_comments
  for select using (can_view_warranty_request(request_id));

create policy "warranty_item_request_comments_insert" on warranty_item_request_comments
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from warranty_item_requests r
      where r.id = warranty_item_request_comments.request_id
      and has_project_access(r.project_id)
    )
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('contractor', 'developer', 'pm'))
  );

create policy "warranty_item_request_comments_delete" on warranty_item_request_comments
  for delete using (auth.uid() = user_id or is_developer());

-- No update/delete policy — see the table comment above.
create policy "activity_log_select" on activity_log
  for select using (has_project_access(project_id));
create policy "activity_log_insert" on activity_log
  for insert with check (has_project_access(project_id) and auth.uid() = user_id);

create policy "bids_member" on bids
  for all using (has_project_access(bids.project_id))
  with check (has_project_access(bids.project_id));

create policy "payment_schedule_items_member" on payment_schedule_items
  for all using (exists (select 1 from bids b where b.id = payment_schedule_items.bid_id and has_project_access(b.project_id)))
  with check (exists (select 1 from bids b where b.id = payment_schedule_items.bid_id and has_project_access(b.project_id)));

create policy "trade_bid_reviews_member" on trade_bid_reviews
  for all using (has_project_access(trade_bid_reviews.project_id))
  with check (has_project_access(trade_bid_reviews.project_id));

create policy "bank_transactions_member" on bank_transactions
  for all using (has_project_access(bank_transactions.project_id))
  with check (has_project_access(bank_transactions.project_id));

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

-- Tighter than tab_permissions_select — these rows are tied to one specific
-- account (a per-user exception, not a shared matrix), so only that
-- account or a Developer can see them.
create policy "user_tab_permissions_select" on user_tab_permissions
  for select using (auth.uid() = user_id or is_developer());
create policy "user_tab_permissions_write" on user_tab_permissions
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

-- Chat: a General (thread_id null) message follows the original rule —
-- any project member can read/post. A scoped-thread message (thread_id
-- set) is only visible to/postable by that thread's own participants,
-- never the whole project. Only the sender (or a Developer) can delete a
-- message either way. No update policy — messages aren't editable in this
-- first pass.
create policy "project_messages_select" on project_messages
  for select using (
    (thread_id is null and has_project_access(project_id))
    or (thread_id is not null and is_thread_participant(thread_id))
  );
create policy "project_messages_insert" on project_messages
  for insert with check (
    auth.uid() = user_id
    and (
      (thread_id is null and has_project_access(project_id))
      or (thread_id is not null and is_thread_participant(thread_id))
    )
  );
create policy "project_messages_delete" on project_messages
  for delete using (auth.uid() = user_id or is_developer());

-- Self-service only, same shape as project_alert_subscriptions — a user
-- manages just their own read marker, never another member's.
create policy "project_chat_reads_owner" on project_chat_reads
  for all using (auth.uid() = user_id)
  with check (has_project_access(project_id) and auth.uid() = user_id);

create policy "chat_threads_select" on chat_threads
  for select using (is_thread_participant(id));
create policy "chat_threads_insert" on chat_threads
  for insert with check (can_create_chat_thread(project_id) and auth.uid() = created_by);
create policy "chat_threads_delete" on chat_threads
  for delete using (auth.uid() = created_by or is_developer());

create policy "chat_thread_participants_select" on chat_thread_participants
  for select using (is_thread_participant(thread_id));
-- Only the thread's own creator (or a Developer) adds/removes
-- participants — same "creator manages membership" shape as
-- project_shares_owner.
create policy "chat_thread_participants_manage" on chat_thread_participants
  for all using (
    exists (select 1 from chat_threads t where t.id = chat_thread_participants.thread_id and (t.created_by = auth.uid() or is_developer()))
  )
  with check (
    exists (select 1 from chat_threads t where t.id = chat_thread_participants.thread_id and (t.created_by = auth.uid() or is_developer()))
  );

create policy "chat_thread_reads_owner" on chat_thread_reads
  for all using (auth.uid() = user_id)
  with check (is_thread_participant(thread_id) and auth.uid() = user_id);

-- Self-service only — a user manages just their own subscription row, never
-- another member's. Dispatching alerts (reading every subscriber's email
-- for a project at once) happens server-side via the service-role admin
-- client in lib/alerts.ts, which bypasses RLS entirely, so it never needs
-- this policy to allow a broader read.
create policy "project_alert_subscriptions_select" on project_alert_subscriptions
  for select using (auth.uid() = user_id);
create policy "project_alert_subscriptions_insert" on project_alert_subscriptions
  for insert with check (has_project_access(project_id) and auth.uid() = user_id);
create policy "project_alert_subscriptions_delete" on project_alert_subscriptions
  for delete using (auth.uid() = user_id);

-- Same self-service-only shape as project_alert_subscriptions above — push
-- dispatch reads every user's subscriptions via the service-role admin
-- client, bypassing RLS entirely.
create policy "push_subscriptions_select" on push_subscriptions
  for select using (auth.uid() = user_id);
create policy "push_subscriptions_insert" on push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy "push_subscriptions_delete" on push_subscriptions
  for delete using (auth.uid() = user_id);

-- Developer-only in both directions — a shared, account-wide policy only
-- the Admin page edits; dispatch always reads it via the service-role
-- admin client anyway (bypassing RLS), so no other role needs read access.
create policy "notification_settings_select" on notification_settings
  for select using (is_developer());
create policy "notification_settings_write" on notification_settings
  for all using (is_developer()) with check (is_developer());

-- Same read boundary as everything else scoped to a construction.
create policy "calendar_events_select" on calendar_events
  for select using (has_project_access(project_id));

-- Everyone with access to the construction can add one, except the
-- 'warranty' role — view-only everywhere outside its own request queue,
-- same carve-out as requireCanManageWarrantyItems.
create policy "calendar_events_insert" on calendar_events
  for insert with check (
    has_project_access(project_id)
    and not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'warranty')
  );

-- Only whoever added an item (or a Developer) can edit or remove it.
create policy "calendar_events_update" on calendar_events
  for update using (created_by = auth.uid() or is_developer())
  with check (created_by = auth.uid() or is_developer());

create policy "calendar_events_delete" on calendar_events
  for delete using (created_by = auth.uid() or is_developer());

-- ---------------------------------------------------------------------------
-- Storage buckets — plan pages, rendering photos, checklist photos, bid PDFs,
-- finish-scan photos
-- ---------------------------------------------------------------------------

-- Private, not public (migration 037) — a "public" bucket serves objects
-- directly with no auth check at all, bypassing the storage.objects RLS
-- policies below entirely for reads. The app instead exchanges each stored
-- URL for a short-lived signed URL right before use (lib/storage.ts),
-- after already checking access at the DB row level.
insert into storage.buckets (id, name, public)
values
  ('plan-pages', 'plan-pages', false),
  ('rendering-photos', 'rendering-photos', false),
  ('checklist-photos', 'checklist-photos', false),
  ('bid-files', 'bid-files', false),
  ('finish-scans', 'finish-scans', false),
  ('project-files', 'project-files', false),
  ('interior-design-photos', 'interior-design-photos', false),
  ('landscape-photos', 'landscape-photos', false)
on conflict (id) do update set public = excluded.public;

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

create policy "landscape_photos_storage_owner" on storage.objects
  for all using (bucket_id = 'landscape-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'landscape-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Realtime — Chat streams new messages via Supabase Realtime's
-- postgres_changes, which respects RLS: a client only receives INSERT
-- events for rows its own project_messages_select policy would let it
-- read anyway. Guarded (not a bare ALTER PUBLICATION) so re-running this
-- file against a project that already has it added doesn't error.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_messages'
  ) then
    alter publication supabase_realtime add table project_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_threads'
  ) then
    alter publication supabase_realtime add table chat_threads;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_thread_participants'
  ) then
    alter publication supabase_realtime add table chat_thread_participants;
  end if;
end $$;
