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
import { isPushConfigured, sendPush } from "@/lib/webPush";

export async function notifyProjectSubscribers(
  projectId: string,
  options: { subject: string; body: string; excludeUserId?: string }
): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: subs, error: subsError }, { data: project, error: projectError }] = await Promise.all([
      admin.from("project_alert_subscriptions").select("id, user_id, email").eq("project_id", projectId),
      admin.from("projects").select("name").eq("id", projectId).maybeSingle(),
    ]);
    // These two used to be silently treated as "no subscribers" on any
    // failure (a bad/mismatched SUPABASE_SERVICE_ROLE_KEY, RLS somehow
    // still applying, etc.) — logging them here is the only way a broken
    // admin-client query surfaces at all, since this function's outer catch
    // only fires on a thrown exception, not a query that merely errors.
    if (subsError) console.warn("notifyProjectSubscribers: could not read subscribers:", subsError.message);
    if (projectError) console.warn("notifyProjectSubscribers: could not read project name:", projectError.message);
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

    // Push is opt-in per device (enabling it has nothing to do with this
    // project alert subscription), so this only ever reaches someone who's
    // both subscribed to this project's alerts AND separately enabled push
    // on at least one browser. Silently skipped whenever VAPID keys aren't
    // configured, same as email silently no-ops without RESEND_API_KEY.
    if (isPushConfigured()) {
      await notifyPushSubscribers(admin, recipients.map((s) => s.user_id), {
        title: projectName,
        body: options.body.slice(0, 180),
        url: origin ? `${origin}/projects/${projectId}` : undefined,
      });
    }
  } catch (err) {
    console.warn("notifyProjectSubscribers failed (non-fatal):", err);
  }
}

async function notifyPushSubscribers(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[],
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .in("user_id", userIds);
  if (error) {
    console.warn("notifyPushSubscribers: could not read subscriptions:", error.message);
    return;
  }
  if (!subs || subs.length === 0) return;

  const goneIds: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      const result = await sendPush(sub, payload);
      if (!result.ok) {
        if (result.gone) goneIds.push(sub.id);
        else console.warn(`notifyPushSubscribers: failed to push to subscription ${sub.id}:`, result.error);
      }
    })
  );

  // A gone subscription (the browser/OS permanently invalidated it) will
  // never succeed again — clean it up so future dispatches stop paying for
  // the failed attempt.
  if (goneIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", goneIds);
  }
}
