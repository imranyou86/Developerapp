import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";
import { BrandMark } from "@/components/BrandMark";
import { AdminClient, type AdminProject, type AdminUser } from "@/app/admin/admin-client";
import { ROLE_VALUES, ALL_TABS } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/permissions-server";
import type { TabPermission } from "@/lib/types";

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

  const [{ data: tabPermissions }, { data: profiles }, { data: projects }] = await Promise.all([
    supabase.from("tab_permissions").select("role, tab, allowed"),
    supabase.from("profiles").select("id, email, role, status").order("email"),
    supabase.from("projects").select("id, name, address, user_id").order("name"),
  ]);

  const users: AdminUser[] = (profiles ?? []) as AdminUser[];
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

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <h1 className="text-lg font-semibold text-blueprint-dark">Admin</h1>
              <p className="text-xs text-blueprint/50">{user.email}</p>
            </div>
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="btn-ghost">
              Sign out
            </button>
          </form>
        </div>
        <TopNav showAdmin showDeals showInteriorDesign showConstructionCost showSubcontractors />
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-6 py-8">
        <AdminClient
          matrix={matrix}
          users={users}
          projects={projectRows}
          currentUserId={user.id}
          currentPreviewRole={currentUser.role}
        />
      </main>
    </div>
  );
}
