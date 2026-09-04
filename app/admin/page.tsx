import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";
import { AdminClient, type AdminProject, type AdminUser } from "@/app/admin/admin-client";
import { ROLE_VALUES, PROJECT_TABS } from "@/lib/permissions";
import type { TabPermission } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "developer") redirect("/projects");

  const [{ data: tabPermissions }, { data: profiles }, { data: projects }] = await Promise.all([
    supabase.from("tab_permissions").select("role, tab, allowed"),
    supabase.from("profiles").select("id, email, role").order("email"),
    supabase.from("projects").select("id, name, address, user_id").order("name"),
  ]);

  const users: AdminUser[] = (profiles ?? []) as AdminUser[];
  const projectRows: AdminProject[] = (projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address,
    ownerEmail: users.find((u) => u.id === p.user_id)?.email ?? p.user_id,
  }));

  // Ensure every (role, tab) pair has a row so the matrix always renders
  // fully even before an admin has touched a given cell.
  const permMap = new Map((tabPermissions ?? []).map((p: TabPermission) => [`${p.role}:${p.tab}`, p.allowed]));
  const matrix = ROLE_VALUES.filter((r) => r !== "developer").map((role) => ({
    role,
    tabs: PROJECT_TABS.map((t) => ({ slug: t.slug, label: t.label, allowed: permMap.get(`${role}:${t.slug}`) ?? true })),
  }));

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blueprint text-sm font-bold text-white">
              TD
            </div>
            <div>
              <h1 className="text-lg font-semibold text-blueprint-dark">Admin</h1>
              <p className="text-xs text-blueprint/50">{user.email}</p>
            </div>
          </div>
        </div>
        <TopNav showAdmin />
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-6 py-8">
        <AdminClient matrix={matrix} users={users} projects={projectRows} currentUserId={user.id} />
      </main>
    </div>
  );
}
