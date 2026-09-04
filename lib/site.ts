import { headers } from "next/headers";

// Server-only. Builds an absolute origin for links embedded in emails
// (Supabase Auth's inviteUserByEmail needs a full redirectTo URL, not a
// path) from the incoming request's Host header — works locally and on
// Vercel without needing a separate NEXT_PUBLIC_SITE_URL env var to keep
// in sync.
export function getSiteOrigin(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`;
}
