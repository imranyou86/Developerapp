"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/projects/actions";
import type { UserRole } from "@/lib/types";

async function requireDeveloper(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "developer") return { ok: false, error: "Developer access required." };
  return { ok: true, userId: user.id };
}

export async function updateTabPermission(role: UserRole, tab: string, allowed: boolean): Promise<ActionResult> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = createClient();
  const { error } = await supabase.from("tab_permissions").upsert({ role, tab, allowed }, { onConflict: "role,tab" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function updateUserRole(userId: string, role: UserRole): Promise<ActionResult> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function updateUserStatus(
  userId: string,
  status: "pending" | "approved" | "rejected"
): Promise<ActionResult> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (userId === auth.userId && status !== "approved") {
    return { ok: false, error: "You can't revoke your own access." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("profiles").update({ status }).eq("id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<ActionResult> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (newPassword.length < 6) return { ok: false, error: "Password must be at least 6 characters." };

  // Sets the password directly via the admin API — no email/current-password
  // needed, unlike the self-service /set-password flow, since a Developer
  // resetting someone else's password can't authenticate as them. The new
  // password is only ever known to the Developer who set it here; make sure
  // to relay it to the account owner out of band.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteUser(userId: string): Promise<ActionResult> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (userId === auth.userId) return { ok: false, error: "You can't delete your own account from here." };

  const supabase = createClient();
  const { data: target } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (target?.role === "developer") {
    const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "developer");
    if ((count ?? 0) <= 1) {
      return { ok: false, error: "Can't delete the last Developer account." };
    }
  }

  // Deletes the auth.users row via the admin API — profiles, project_members,
  // and any project_invites they sent all cascade-delete along with it
  // (on delete cascade FKs in supabase/schema.sql), so no manual cleanup
  // needed here. Projects/rooms/etc. they *owned* are untouched (owned by
  // projects.user_id, not by a profile row) but become inaccessible once
  // their owner account is gone unless another member/Developer still has
  // has_project_access to them.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
