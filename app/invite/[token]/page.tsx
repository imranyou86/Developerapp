import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function InviteMessage({ title, body, showSignOut }: { title: string; body: string; showSignOut?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-concrete px-4">
      <div className="card max-w-sm space-y-3 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blueprint text-lg font-bold text-white">
          TD
        </div>
        <h1 className="text-lg font-semibold text-blueprint-dark">{title}</h1>
        <p className="text-sm text-blueprint/60">{body}</p>
        {showSignOut && (
          <form action="/auth/signout" method="post">
            <button type="submit" className="btn-outline w-full">
              Sign out and try a different account
            </button>
          </form>
        )}
        <Link href="/projects" className="block text-xs text-blueprint/50 hover:text-amber">
          ← Back to my constructions
        </Link>
      </div>
    </div>
  );
}

export default async function InvitePage({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already sends unauthenticated visitors to /login?next=..., but
  // guard here too in case this page is ever reached without a session.
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${params.token}`)}`);
  }

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("project_invites")
    .select("id, project_id, email, role, status")
    .eq("token", params.token)
    .maybeSingle();

  if (!invite) {
    return <InviteMessage title="Invite not found" body="This invite link doesn't exist. Ask the developer for a new one." />;
  }
  if (invite.status === "revoked") {
    return <InviteMessage title="Invite revoked" body="This invite has been revoked. Ask the developer for a new one." />;
  }
  if (invite.status === "accepted") {
    redirect(`/projects/${invite.project_id}`);
  }
  if (invite.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return (
      <InviteMessage
        title="Wrong account"
        body={`This invite was sent to ${invite.email}, but you're signed in as ${user.email}.`}
        showSignOut
      />
    );
  }

  const { error: memberError } = await admin
    .from("project_members")
    .upsert({ project_id: invite.project_id, user_id: user.id, role: invite.role }, { onConflict: "project_id,user_id" });

  if (memberError) {
    return <InviteMessage title="Couldn't join" body={memberError.message} />;
  }

  // Inviting someone as "Developer" is a special case — it's an admin role,
  // not a per-project one, so accepting it also promotes their account
  // (profiles.role), granting them full access everywhere and the Admin
  // page, not just this project.
  if (invite.role === "developer") {
    const { error: profileError } = await admin.from("profiles").update({ role: "developer" }).eq("id", user.id);
    if (profileError) {
      return <InviteMessage title="Couldn't grant Developer access" body={profileError.message} />;
    }
  }

  await admin
    .from("project_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  redirect(`/projects/${invite.project_id}`);
}
