"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteOrigin } from "@/lib/site";
import type { ActionResult } from "@/app/projects/actions";
import type { UserRole } from "@/lib/types";

// Every action here re-checks the caller's role server-side even though RLS
// also enforces "developer only" on project_invites — cheaper to fail with
// a clear message here than to surface a raw Postgres RLS error.
async function requireDeveloper(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "developer") return { ok: false, error: "Only a Developer can send project invites." };
  return { ok: true, userId: user.id };
}

export async function sendProjectInvite(
  projectId: string,
  email: string,
  role: UserRole
): Promise<ActionResult & { token?: string; emailSent?: boolean; emailNote?: string }> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) return { ok: false, error: "Enter a valid email." };

  const supabase = createClient();
  const token = crypto.randomBytes(24).toString("base64url");

  const { data, error } = await supabase
    .from("project_invites")
    .insert({ project_id: projectId, email: normalizedEmail, role, invited_by: auth.userId, token })
    .select("id, token")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/admin");

  // Try to actually email the invite via Supabase Auth's own invite flow —
  // it only works for an email with no existing account (that's how
  // GoTrue's admin API is designed: it creates the auth user in an
  // "invited" state and emails them a sign-in link). For an email that
  // already has an account, there's no equivalent "send them an email"
  // admin call without a separate email provider, so this falls back to
  // "copy the link yourself" — never treated as a hard failure, since the
  // invite row + link both still work either way.
  let emailSent = false;
  let emailNote: string | undefined;
  try {
    const admin = createAdminClient();
    const redirectTo = `${getSiteOrigin()}/invite/${token}`;
    // A Developer sending this invite is itself the access decision — mark
    // the new account pre-approved (see handle_new_user() in schema.sql) so
    // it never lands in the pending-approval queue meant for the public
    // /login sign-up form.
    const { error: inviteEmailError } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo,
      data: { status: "approved" },
    });
    if (inviteEmailError) {
      const alreadyRegistered = /already|exist/i.test(inviteEmailError.message);
      emailNote = alreadyRegistered
        ? "This person already has an account — copy the link below and send it to them yourself."
        : `Could not send an email automatically (${inviteEmailError.message}) — copy the link below and send it yourself.`;
    } else {
      emailSent = true;
    }
  } catch (err) {
    emailNote = `Could not send an email automatically (${err instanceof Error ? err.message : "unknown error"}) — copy the link below and send it yourself.`;
  }

  return { ok: true, id: data.id, token: data.token, emailSent, emailNote };
}

export async function revokeInvite(inviteId: string, projectId: string): Promise<ActionResult> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = createClient();
  const { error } = await supabase.from("project_invites").update({ status: "revoked" }).eq("id", inviteId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/admin");
  return { ok: true };
}

export async function removeMember(memberId: string, projectId: string): Promise<ActionResult> {
  const auth = await requireDeveloper();
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = createClient();
  const { error } = await supabase.from("project_members").delete().eq("id", memberId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/admin");
  return { ok: true };
}

export interface ProjectInviteRow {
  id: string;
  email: string;
  role: UserRole;
  status: "pending" | "accepted" | "revoked";
  token: string;
  created_at: string;
}

export interface ProjectMemberRow {
  id: string;
  user_id: string;
  role: UserRole;
  email: string | null;
}

export async function listProjectInvitesAndMembers(
  projectId: string
): Promise<{ invites: ProjectInviteRow[]; members: ProjectMemberRow[] }> {
  const supabase = createClient();
  const [{ data: invites }, { data: members }] = await Promise.all([
    supabase
      .from("project_invites")
      .select("id, email, role, status, token, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase.from("project_members").select("id, user_id, role").eq("project_id", projectId),
  ]);

  let memberRows: ProjectMemberRow[] = (members ?? []).map((m) => ({ ...m, email: null }));
  if (memberRows.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in(
        "id",
        memberRows.map((m) => m.user_id)
      );
    const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]));
    memberRows = memberRows.map((m) => ({ ...m, email: emailById.get(m.user_id) ?? null }));
  }

  return { invites: invites ?? [], members: memberRows };
}
