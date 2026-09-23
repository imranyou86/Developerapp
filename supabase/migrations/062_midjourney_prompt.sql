-- Room rendering concepts also get a Midjourney-syntax prompt now
-- (comma-separated descriptors + --ar/--style raw/--v/--stylize
-- parameters), alongside the existing plain image_prompt used to
-- generate directly in-app via Gemini. Midjourney has no official API
-- (still true as of this migration — Discord bot/web app only), so this
-- is copy-paste only: a "Copy Midjourney prompt" button, no in-app call.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-061 applied.

alter table renderings add column if not exists midjourney_prompt text;
