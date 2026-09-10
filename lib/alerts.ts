// Server-only. Fires an opt-in email alert to everyone subscribed to a
// project (app/projects/[id]/alerts-actions.ts) whenever something worth
// knowing about happens there — a chat message, a checklist/warranty item
// added or marked fixed, a warranty item's review status changing.
//
// Reads subscribers via the service-role admin client (lib/supabase/admin.ts)
// rather than the caller's own session — project_alert_subscriptions_select
// only allows a user to see their own subscription row, since dispatch is a
// system operation, not something any one caller should be able to read
// other members' rows through. Best-effort throughout: a broken RESEND_API_KEY
// or a delivery failure never breaks the action that triggered the alert —
// see every catch below.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { getSiteOrigin } from "@/lib/site";

export async function notifyProjectSubscribers(
  projectId: string,
  options: { subject: string; body: string; excludeUserId?: string }
): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: subs }, { data: project }] = await Promise.all([
      admin.from("project_alert_subscriptions").select("id, user_id, email").eq("project_id", projectId),
      admin.from("projects").select("name").eq("id", projectId).maybeSingle(),
    ]);
    if (!subs || subs.length === 0) return;

    const projectName = project?.name ?? "your construction";
    const recipients = subs.filter((s) => s.user_id !== options.excludeUserId);
    if (recipients.length === 0) return;

    // getSiteOrigin() reads the current request's Host header (via
    // next/headers), so this only works called from within a live request —
    // true for every call site today (Server Actions triggered by a user
    // request). Falls back to a relative-looking note rather than throwing
    // if that ever changes.
    let origin: string;
    try {
      origin = getSiteOrigin();
    } catch {
      origin = "";
    }

    await Promise.all(
      recipients.map((s) => {
        // The subscription row's own id (a random uuid) doubles as the
        // unsubscribe token — same "unguessable id in a public link"
        // pattern project_shares/project_invites already use.
        const unsubscribeLine = origin
          ? `\n\nNo longer want these emails? Unsubscribe: ${origin}/api/alerts/unsubscribe?sub=${s.id}`
          : "";
        return sendEmail({
          to: s.email,
          subject: `${projectName}: ${options.subject}`,
          text: `${options.body}\n\n— Alaia Homes Dev.${unsubscribeLine}`,
        }).catch((err) => console.warn(`notifyProjectSubscribers: failed to email ${s.email}:`, err));
      })
    );
  } catch (err) {
    console.warn("notifyProjectSubscribers failed (non-fatal):", err);
  }
}
