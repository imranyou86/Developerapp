import { createClient } from "@/lib/supabase/server";
import { PROJECT_TABS, type CurrentUser, type ProjectTabDef } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

// Server-side only (uses next/headers via lib/supabase/server). Falls back
// to "owner" if a profile row is somehow missing (shouldn't happen post-
// signup-trigger, but keeps the app usable rather than locking someone out).
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { id: user.id, email: user.email ?? null, role: (profile?.role as UserRole) ?? "owner" };
}

// A Developer always has every tab, regardless of what's stored — the
// tab_permissions table only governs Owner/PM/Contractor and is what the
// Admin page edits. `tabs` defaults to the per-project tabs but the same
// table/shape also governs top-level sections like Buyers Guide
// (lib/permissions.ts's TOP_LEVEL_TABS) — pass that in explicitly there.
export async function getAllowedTabSlugs(role: UserRole, tabs: ProjectTabDef[] = PROJECT_TABS): Promise<string[]> {
  if (role === "developer") return tabs.map((t) => t.slug);

  const supabase = createClient();
  const { data } = await supabase
    .from("tab_permissions")
    .select("tab, allowed")
    .eq("role", role)
    .in(
      "tab",
      tabs.map((t) => t.slug)
    );
  if (!data) return tabs.map((t) => t.slug);

  const disallowed = new Set(data.filter((row) => !row.allowed).map((row) => row.tab));
  return tabs.filter((t) => !disallowed.has(t.slug)).map((t) => t.slug);
}
