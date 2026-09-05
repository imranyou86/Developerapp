import { createAdminClient } from "@/lib/supabase/admin";
import { BrandMark } from "@/components/BrandMark";
import {
  BudgetSection,
  ChecklistSection,
  PaymentsSection,
  PlanSection,
  RoomsSection,
} from "@/app/share/[token]/sections";

export const dynamic = "force-dynamic";

function InvalidLink({ reason }: { reason: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-concrete px-4">
      <div className="card max-w-sm p-8 text-center">
        <BrandMark size="lg" className="mx-auto mb-3" />
        <h1 className="text-lg font-semibold text-blueprint-dark">Link not available</h1>
        <p className="mt-2 text-sm text-blueprint/60">{reason}</p>
      </div>
    </div>
  );
}

export default async function SharePage({ params }: { params: { token: string } }) {
  const supabase = createAdminClient();

  const { data: share } = await supabase
    .from("project_shares")
    .select("id, project_id, revoked_at")
    .eq("token", params.token)
    .maybeSingle();

  if (!share) {
    return <InvalidLink reason="This share link doesn't exist. Ask for a new one." />;
  }
  if (share.revoked_at) {
    return <InvalidLink reason="This share link has been revoked by the project owner." />;
  }

  const projectId = share.project_id;

  const [
    { data: project },
    { data: planPages },
    { data: rooms },
    { data: checklistItems },
    { data: bids },
  ] = await Promise.all([
    supabase.from("projects").select("id, name, address").eq("id", projectId).single(),
    supabase.from("plan_pages").select("id, storage_url, label, sort_order").eq("project_id", projectId).order("sort_order"),
    supabase
      .from("rooms")
      .select(
        `id, name, type, width, depth, floor, estimated,
         tasks ( id, title, due_date, done ),
         budget_items ( id, item, budgeted, actual ),
         finishes ( id, name, category, brand, price ),
         renderings ( id, style, illustration_svg, uploaded_photo_url, description )`
      )
      .eq("project_id", projectId)
      .order("name"),
    supabase
      .from("checklist_items")
      .select("id, phase, title, done, comment, sort_order, checklist_photos ( id, storage_url )")
      .eq("project_id", projectId)
      .order("sort_order"),
    // Only accepted bids — bids still under review (or declined) are shown
    // in the app's own Bids tab, not on a link shared outside the team.
    supabase
      .from("bids")
      .select("id, contractor, total_amount, file_name, file_url, uploaded_at, payment_schedule_items ( id, label, amount, paid )")
      .eq("project_id", projectId)
      .eq("status", "accepted")
      .order("uploaded_at", { ascending: false }),
  ]);

  if (!project) {
    return <InvalidLink reason="This construction no longer exists." />;
  }

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <span className="badge-amber">Shared read-only view</span>
          <h1 className="mt-2 text-xl font-semibold text-blueprint-dark">{project.name}</h1>
          {project.address && <p className="text-sm text-blueprint/50">{project.address}</p>}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-6 py-8">
        <PlanSection pages={planPages ?? []} />
        <RoomsSection rooms={rooms ?? []} />
        <ChecklistSection items={checklistItems ?? []} />
        <BudgetSection rooms={rooms ?? []} />
        <PaymentsSection bids={bids ?? []} />
      </main>

      <footer className="border-t border-blueprint/10 py-6 text-center text-xs text-blueprint/40">
        Shared via Alaia Homes Dev — view only.
      </footer>
    </div>
  );
}
