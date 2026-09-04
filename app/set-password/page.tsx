import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetPasswordClient } from "@/app/set-password/set-password-client";

export const dynamic = "force-dynamic";

// Reached right after accepting an invite (an account created via
// admin.inviteUserByEmail has no password at all — invited users can only
// sign back in with another emailed link until they set one here) — or
// anytime someone wants to add/change a password.
export default async function SetPasswordPage({ searchParams }: { searchParams: { next?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const next = searchParams.next ?? "/projects";
  if (!user) redirect(`/login?next=${encodeURIComponent(`/set-password?next=${next}`)}`);

  return <SetPasswordClient email={user.email ?? ""} next={next} />;
}
