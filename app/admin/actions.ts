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

// Shown in chat and warranty-request comments instead of the raw email
// (denormalized onto each message/comment at write time — see
// sendMessage/addWarrantyRequestComment). null clears it back to
// email-only display.
export async function updateUserDisplayName(userId: string, displayName: string | null): Promise<ActionResult> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = createClient();
  const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", userId);
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

// Creates an account directly from the Admin portal — a test account made
// to try out a role's permissions, or a real account handed to a specific
// person — without going through the public /login sign-up form (and its
// pending-approval queue, meant for that unsolicited path, not one a
// Developer already deliberately chose to create). role/status are passed
// as auth user_metadata, which handle_new_user() (supabase/schema.sql)
// reads when it inserts the profiles row — same mechanism
// invite-actions.ts's inviteUserByEmail already relies on for
// pre-approving invited accounts, just with a password set up front here
// instead of an emailed sign-in link.
export async function createAccount(input: {
  email: string;
  password: string;
  role: UserRole;
  isTest: boolean;
}): Promise<ActionResult & { userId?: string }> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };

  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email." };
  if (input.password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { role: input.role, status: "approved" },
  });
  if (error) return { ok: false, error: error.message };
  const userId = data.user.id;

  if (input.isTest) {
    const supabase = createClient();
    const { error: updateError } = await supabase.from("profiles").update({ is_test: true }).eq("id", userId);
    if (updateError) return { ok: false, error: updateError.message };
  }

  revalidatePath("/admin");
  return { ok: true, userId };
}

// A per-account exception on top of the role-wide tab_permissions matrix —
// see user_tab_permissions in supabase/schema.sql. `allowed: null` clears
// the override for that tab (falls back to the role default again) instead
// of storing an explicit true/false.
export async function updateUserTabPermission(userId: string, tab: string, allowed: boolean | null): Promise<ActionResult> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = createClient();
  if (allowed === null) {
    const { error } = await supabase.from("user_tab_permissions").delete().eq("user_id", userId).eq("tab", tab);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("user_tab_permissions").upsert({ user_id: userId, tab, allowed }, { onConflict: "user_id,tab" });
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/admin");
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
