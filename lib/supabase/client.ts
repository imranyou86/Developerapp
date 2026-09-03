import { createBrowserClient } from "@supabase/ssr";

// Not parameterized with a generated Database type — run `supabase gen
// types typescript` against your project and wire it back in once you have
// a live schema to generate from. Domain types in lib/types.ts cover the
// app's own component/action signatures in the meantime.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
