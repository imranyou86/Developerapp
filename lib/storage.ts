import { createAdminClient } from "@/lib/supabase/admin";

// Long enough to survive a normal page session, a background AI fetch
// relayed from the client (upload → analyze can be a few requests apart),
// and casual link-sharing within one browser tab — while still expiring,
// unlike the permanently-public URLs these replace (see migration 037,
// which flips every Storage bucket from public to private).
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24 hours

interface ParsedStorageUrl {
  bucket: string;
  path: string;
}

const STORAGE_URL_RE = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/;

export function parseStorageUrl(url: string): ParsedStorageUrl | null {
  const match = url.match(STORAGE_URL_RE);
  if (!match) return null;
  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}

// Every `storage_url`-shaped column still stores the same string an
// upload's `getPublicUrl(path)` call always produced — now private buckets
// mean that string no longer resolves on its own, so it's just a bucket+path
// encoder. This exchanges one for a short-lived signed URL right before it's
// handed to a client or fetched server-side.
//
// Access control already happened at the DB row level by the time this
// runs — has_project_access RLS on whatever table the row came from — so
// signing always uses the service-role admin client rather than the
// caller's own session. The per-bucket "owner" storage.objects policies
// (storage.foldername(name))[1] = auth.uid()) only ever scoped access to
// the *uploader's own* folder, which would otherwise lock every other
// project member out of a co-member's upload the moment the bucket went
// private — the row-level check is the real gate here, not those policies.
export async function signStorageUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const parsed = parseStorageUrl(url);
  if (!parsed) return url; // not one of our storage URLs — pass through unchanged

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(parsed.bucket).createSignedUrl(parsed.path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.error(`Failed to sign storage URL (${parsed.bucket}/${parsed.path}):`, error?.message);
    return null;
  }
  return data.signedUrl;
}

// Bulk variant, batched per bucket (Storage's createSignedUrls call only
// covers one bucket at a time) — a list of many objects from the same
// bucket, the common case for a photo gallery or the Files Library, costs
// one round trip per bucket instead of one per object.
export async function signStorageUrls(urls: (string | null | undefined)[]): Promise<(string | null)[]> {
  const parsedList = urls.map((u) => (u ? parseStorageUrl(u) : null));
  const byBucket = new Map<string, string[]>();
  for (const parsed of parsedList) {
    if (!parsed) continue;
    const list = byBucket.get(parsed.bucket) ?? [];
    list.push(parsed.path);
    byBucket.set(parsed.bucket, list);
  }
  if (byBucket.size === 0) return urls.map((u) => u ?? null);

  const admin = createAdminClient();
  const signedByKey = new Map<string, string>();
  await Promise.all(
    Array.from(byBucket.entries()).map(async ([bucket, paths]) => {
      const { data, error } = await admin.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      if (error || !data) {
        console.error(`Failed to sign storage URLs for bucket "${bucket}":`, error?.message);
        return;
      }
      data.forEach((entry, i) => {
        if (entry.signedUrl) signedByKey.set(`${bucket}::${paths[i]}`, entry.signedUrl);
      });
    })
  );

  return parsedList.map((parsed, i) => {
    if (!parsed) return urls[i] ?? null; // not one of our storage URLs — pass through unchanged
    return signedByKey.get(`${parsed.bucket}::${parsed.path}`) ?? null;
  });
}

// Convenience for the common "array of rows, sign one column" shape. `T
// extends object` (not `Record<string, unknown>`) so a concrete row
// interface without an index signature — e.g. LandscapeDesign — is still
// accepted.
export async function signRowsUrl<T extends object, K extends keyof T>(rows: T[], key: K): Promise<T[]> {
  if (rows.length === 0) return rows;
  const signed = await signStorageUrls(rows.map((r) => r[key] as unknown as string | null));
  return rows.map((r, i) => ({ ...r, [key]: signed[i] }));
}
