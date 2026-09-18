import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";
import { BrandMark } from "@/components/BrandMark";
import { AdminClient, type AdminProject, type AdminUser } from "@/app/admin/admin-client";
import { ROLE_VALUES, ALL_TABS } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/permissions-server";
import { NOTIFICATION_ACTIONS } from "@/lib/notificationCatalog";
import type { TabPermission, UserTabPermission, UserRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  // Checks the real account role (isDeveloper), not the effective/previewed
  // one — the "Preview as…" picker itself lives on this page now, so it
  // has to stay reachable to a real Developer no matter what role they're
  // currently previewing, or there'd be no way back to turn it off.
  const currentUser = await getCurrentUser();
  if (!currentUser?.isDeveloper) redirect("/projects");

  const [{ data: tabPermissions }, { data: profiles }, { data: projects }, { data: userTabPermissions }, { data: notificationSettings }] =
    await Promise.all([
      supabase.from("tab_permissions").select("role, tab, allowed"),
      supabase.from("profiles").select("id, email, role, status, is_test, display_name").order("email"),
      supabase.from("projects").select("id, name, address, user_id").order("name"),
      supabase.from("user_tab_permissions").select("user_id, tab, allowed"),
      supabase.from("notification_settings").select("action, enabled, roles"),
    ]);

  // Grouped by user so each row's "Permissions" panel already has its own
  // overrides on hand without a fetch of its own.
  const userOverrides = new Map<string, Record<string, boolean>>();
  for (const row of (userTabPermissions ?? []) as UserTabPermission[]) {
    const existing = userOverrides.get(row.user_id) ?? {};
    existing[row.tab] = row.allowed;
    userOverrides.set(row.user_id, existing);
  }

  const users: AdminUser[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    role: p.role,
    status: p.status,
    isTest: p.is_test,
    displayName: p.display_name,
    tabOverrides: userOverrides.get(p.id) ?? {},
  }));
  const projectRows: AdminProject[] = (projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address,
    ownerId: p.user_id,
    ownerEmail: users.find((u) => u.id === p.user_id)?.email ?? p.user_id,
  }));

  // Ensure every (role, tab) pair has a row so the matrix always renders
  // fully even before an admin has touched a given cell.
  const permMap = new Map((tabPermissions ?? []).map((p: TabPermission) => [`${p.role}:${p.tab}`, p.allowed]));
  const matrix = ROLE_VALUES.filter((r) => r !== "developer").map((role) => ({
    role,
    tabs: ALL_TABS.map((t) => ({ slug: t.slug, label: t.label, allowed: permMap.get(`${role}:${t.slug}`) ?? true })),
  }));

  // Same "ensure every row exists" merge as the tab_permissions matrix
  // above — a catalog entry with no notification_settings row yet (a
  // fresh action whose seed migration hasn't run) still renders with its
  // catalog default instead of disappearing from the list.
  const notificationSettingsByAction = new Map((notificationSettings ?? []).map((n) => [n.action, n]));
  const notificationRows = NOTIFICATION_ACTIONS.map((a) => {
    const row = notificationSettingsByAction.get(a.key);
    return {
      key: a.key,
      label: a.label,
      description: a.description,
      enabled: row?.enabled ?? true,
      roles: (row?.roles ?? a.defaultRoles) as UserRole[],
    };
  });

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-y-2 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-blueprint-dark">Admin</h1>
              <p className="truncate text-xs text-blueprint/50">{user.email}</p>
            </div>
          </div>
          <form action="/auth/signout" method="post" className="shrink-0">
            <button type="submit" className="btn-ghost">
              Sign out
            </button>
          </form>
        </div>
        <TopNav showAdmin showDeals showInteriorDesign showConstructionCost showLandscape showSubcontractors />
      </header>

      <main className="mx-auto max-w-5xl animate-fade-in-up space-y-10 px-6 py-8">
        <AdminClient
          matrix={matrix}
          users={users}
          projects={projectRows}
          notificationSettings={notificationRows}
          currentUserId={user.id}
          currentPreviewRole={currentUser.role}
        />
      </main>
    </div>
  );
}
