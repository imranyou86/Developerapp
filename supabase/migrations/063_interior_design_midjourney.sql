-- Interior Design gets the same Gemini-or-Midjourney-only choice Rooms &
-- Tasks already has (migration 062): previously every design always
-- generated (and required) a Gemini image; now a design can instead be a
-- Midjourney-prompt-only entry with no generated image at all, so
-- generated_image_url and prompt (which always held the Gemini prompt)
-- both need to become optional, and a new midjourney_prompt column holds
-- the copy-paste prompt for that path. Midjourney has no official API, so
-- this is never called from this app.
--
-- Run this once in the Supabase SQL editor against an EXISTING project
-- that already has migrations 001-062 applied.

alter table interior_designs add column if not exists midjourney_prompt text;
alter table interior_designs alter column generated_image_url drop not null;
alter table interior_designs alter column prompt drop not null;
