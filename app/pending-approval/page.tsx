import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PendingApprovalPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("status").eq("id", user.id).maybeSingle();
  // Approved accounts never render this (middleware bounces them straight
  // to /projects), so anything other than 'rejected' here reads as pending —
  // including a still-missing profile row, the safer default.
  const rejected = profile?.status === "rejected";

  return (
    <div className="flex min-h-screen items-center justify-center bg-concrete px-4">
      <div className="card max-w-sm space-y-3 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blueprint text-lg font-bold text-white">
          TD
        </div>
        {rejected ? (
          <>
            <h1 className="text-lg font-semibold text-blueprint-dark">Access declined</h1>
            <p className="text-sm text-blueprint/60">
              A Developer administrator has declined access for {user.email} to The Developer. If you believe this is
              a mistake, contact them directly.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-blueprint-dark">Awaiting approval</h1>
            <p className="text-sm text-blueprint/60">
              Your account ({user.email}) has been created, but a Developer administrator still needs to approve it
              before you can use The Developer. Check back soon, or reach out to them directly.
            </p>
          </>
        )}
        <form action="/auth/signout" method="post">
          <button type="submit" className="btn-outline w-full">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
