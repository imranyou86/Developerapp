// Client-safe constant only — no service-role key or next/headers import,
// unlike lib/storage.ts (which does the actual re-signing on read). Used
// right after an upload so the URL saved to the DB, and used for the
// immediate optimistic preview, is a working signed URL rather than a
// "public"-shaped one that 403s the moment it's requested (every bucket is
// private — see migration 037). The uploader can sign their own just-
// uploaded object directly via the browser client because the existing
// per-bucket storage.objects policy scopes read/write to
// (storage.foldername(name))[1] = auth.uid() — the uploader's own folder.
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24 hours — matches lib/storage.ts
