import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_TABS, PREVIEW_ROLE_COOKIE, ROLE_VALUES, type CurrentUser, type ProjectTabDef } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

// Server-side only (uses next/headers via lib/supabase/server). Falls back
// to "owner" if a profile row is somehow missing (shouldn't happen post-
// signup-trigger, but keeps the app usable rather than locking someone out).
//
// A Developer previewing another role (see PREVIEW_ROLE_COOKIE) gets back
// `role` set to the previewed role — every caller that gates on `role`
// (tab visibility, the Admin page's own guard, the Invite button, etc.)
// then naturally behaves as that role would, without touching the real
// account. `isDeveloper` always reflects the real, stored account role so
// the preview picker itself keeps showing regardless of the active preview.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const realRole = (profile?.role as UserRole) ?? "owner";
  const isDeveloper = realRole === "developer";

  let role = realRole;
  if (isDeveloper) {
    const preview = cookies().get(PREVIEW_ROLE_COOKIE)?.value;
    if (preview && preview !== "developer" && ROLE_VALUES.includes(preview as UserRole)) {
      role = preview as UserRole;
    }
  }

  return { id: user.id, email: user.email ?? null, role, isDeveloper };
}

// A Developer always has every tab, regardless of what's stored — the
// tab_permissions table only governs Owner/PM/Contractor and is what the
// Admin page edits. `tabs` defaults to the per-project tabs but the same
// table/shape also governs top-level sections like Buyers Guide
// (lib/permissions.ts's TOP_LEVEL_TABS) — pass that in explicitly there.
//
// `userId`, when passed, layers user_tab_permissions on top of the role
// matrix — a per-account exception (e.g. a test account created from Admin
// to try out a narrower/wider slice of a role's tabs) that wins over the
// role default for that one account only, everyone else on the same role
// unaffected. Every call site passes the real signed-in user's id, not a
// Developer's "preview as" role, since previewing simulates a role in the
// abstract, not a specific target account.
export async function getAllowedTabSlugs(role: UserRole, tabs: ProjectTabDef[] = PROJECT_TABS, userId?: string): Promise<string[]> {
  if (role === "developer") return tabs.map((t) => t.slug);

  const supabase = createClient();
  const slugs = tabs.map((t) => t.slug);
  const [{ data }, { data: userData }] = await Promise.all([
    supabase.from("tab_permissions").select("tab, allowed").eq("role", role).in("tab", slugs),
    userId
      ? supabase.from("user_tab_permissions").select("tab, allowed").eq("user_id", userId).in("tab", slugs)
      : Promise.resolve({ data: null as { tab: string; allowed: boolean }[] | null }),
  ]);
  // Fail closed, not open: a missing or empty result means this role has no
  // configured rows (a query error, or a seeding migration that never ran)
  // — treating that as "nothing disallowed" would silently hand out full
  // access instead. `data` being `[]` is truthy, so this has to be checked
  // separately from `!data`. Computed as its own role-only baseline before
  // any per-user override is layered on, so an override for one tab can
  // never flip this fail-closed default open for every OTHER tab the user
  // wasn't explicitly granted.
  let roleAllowed: Set<string>;
  if (!data || data.length === 0) {
    roleAllowed = new Set();
  } else {
    const disallowed = new Set(data.filter((row) => !row.allowed).map((row) => row.tab));
    roleAllowed = new Set(tabs.filter((t) => !disallowed.has(t.slug)).map((t) => t.slug));
  }

  const overrideMap = new Map((userData ?? []).map((row) => [row.tab, row.allowed]));
  return tabs.filter((t) => (overrideMap.has(t.slug) ? overrideMap.get(t.slug)! : roleAllowed.has(t.slug))).map((t) => t.slug);
}
