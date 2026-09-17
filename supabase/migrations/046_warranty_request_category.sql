-- "Create a Warranty Request" is now a dedicated, standalone tab
-- experience for the 'warranty' role (app/projects/[id]/warranty-request/
-- create-warranty-request-form.tsx) — a single-purpose submission form
-- (title, description, category, file/photo attachments) rather than the
-- full tracking dashboard Contractor/Developer/PM use. This adds the
-- category field that form collects.
--
-- Plain nullable text, no DB check constraint — same as
-- bank_transactions.category — the fixed option list
-- (lib/warrantyRequestCategories.ts) is enforced only at the UI layer.
alter table warranty_item_requests add column if not exists category text;

-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-045 applied.
