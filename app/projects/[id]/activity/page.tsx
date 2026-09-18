import { createClient } from "@/lib/supabase/server";
import type { ActivityLogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// Fallback for the rare row with no `detail` (see lib/activityLog.ts call
// sites) — most already write a full human sentence, this only covers the
// gaps. Keep in sync with every `action:` string passed to logActivity.
const ACTION_LABELS: Record<string, string> = {
  "bid.accepted": "Accepted a bid",
  "bid.declined": "Declined a bid",
  "bid.deleted": "Deleted a bid",
  "project_invite.revoked": "Revoked an invite",
  "project_member.added": "Added a team member",
  "project_member.removed": "Removed a team member",
  "warranty_item.deleted": "Deleted a warranty item",
  "inspection_report.deleted": "Deleted an inspection report",
  "warranty_item_request.approved": "Approved a warranty request",
  "warranty_item_request.rejected": "Rejected a warranty request",
  "warranty_item_request.deleted": "Deleted a warranty request",
  "project_file.deleted": "Deleted a file",
  "project_file.bulk_deleted": "Deleted files",
};

const LIMIT = 300;

export default async function ActivityPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .eq("project_id", params.id)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  const entries = (data ?? []) as ActivityLogEntry[];

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h2 className="font-semibold text-blueprint-dark">Activity</h2>
        <p className="text-sm text-blueprint/60">
          An audit trail of the highest-stakes actions on this construction — deleting or approving
          warranty items, accepting or deleting a bid, removing a team member&apos;s access, and
          deleting a file. Not every change is logged here, only the ones most likely to matter in a
          dispute or a &quot;who did that?&quot; moment.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load activity: {error.message}
        </div>
      )}

      {!error && entries.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">No activity recorded yet.</div>
      ) : (
        <div className="card divide-y divide-blueprint/10">
          {entries.map((entry, i) => (
            <div key={entry.id} className="animate-fade-in-up flex items-start gap-3 px-5 py-3" style={{ animationDelay: `${Math.min(i * 15, 300)}ms` }}>
              <div className="flex-1">
                <p className="text-sm text-blueprint-dark">{entry.detail ?? ACTION_LABELS[entry.action] ?? entry.action}</p>
                <p className="mt-0.5 text-xs text-blueprint/50">
                  {entry.actor_name ?? "Someone"} · {new Date(entry.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      {entries.length === LIMIT && (
        <p className="text-center text-xs text-blueprint/40">Showing the most recent {LIMIT} entries.</p>
      )}
    </div>
  );
}
