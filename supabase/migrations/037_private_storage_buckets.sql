-- Flips every Storage bucket from public to private. Until now, anyone with
-- a stored file's URL — plan pages, room renderings, checklist/warranty
-- photos, bid PDFs, finish scans, inspection reports, interior design and
-- landscape renders, everything in the Files Library — could read it with
-- no authentication at all, because a "public" bucket serves objects
-- directly and ignores the storage.objects RLS policies entirely (those
-- policies were only ever enforced for uploads/deletes going through the
-- authenticated Storage API, never for reads via the public URL). For a
-- tool holding photos and documents of someone's home construction, that's
-- real exposure.
--
-- The app now exchanges each stored "storage_url" for a short-lived signed
-- URL right before it's used (see lib/storage.ts's signStorageUrl /
-- signStorageUrls, called from every page/route that reads one) — access
-- control happens at the DB row level (has_project_access RLS) before
-- signing, via the service-role admin client, same as the alerts dispatch
-- and rate-limit bookkeeping already do.
--
-- Run this AFTER deploying the app code that signs these URLs (this whole
-- commit) — flipping the buckets first would break every image/file link
-- in a still-running old deployment.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migrations 001-036 applied.

update storage.buckets
set public = false
where id in (
  'plan-pages',
  'rendering-photos',
  'checklist-photos',
  'bid-files',
  'finish-scans',
  'project-files',
  'interior-design-photos',
  'landscape-photos'
);
