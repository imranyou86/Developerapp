import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Server-only. Bypasses row-level security entirely via the service-role
// key — never import this from a Client Component, and never forward its
// results to a request without first checking the caller is authorized
// (e.g. validating a share token). Used by the public /share/[token] page,
// which has no authenticated user and therefore no auth.uid() for RLS to
// scope against.
export function createAdminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
