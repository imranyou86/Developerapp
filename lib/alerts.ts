// Server-only. Fires an alert whenever something worth knowing about
// happens on a project — a chat message, a checklist/warranty item added
// or marked fixed, a warranty item's review status changing — either to
// everyone who's opted in via "Get alerts" (notifyProjectSubscribers) or,
// for a couple of role-specific events, to whoever's actually responsible
// for acting on it regardless of opt-in (notifyProjectRoles).
//
// Reads subscribers/profiles via the service-role admin client
// (lib/supabase/admin.ts) rather than the caller's own session —
// project_alert_subscriptions_select only allows a user to see their own
// subscription row, since dispatch is a system operation, not something
// any one caller should be able to read other members' rows through.
// Best-effort throughout: a broken RESEND_API_KEY/VAPID key or a delivery
// failure never breaks the action that triggered the alert — see every
// catch below.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { getSiteOrigin } from "@/lib/site";
import { isPushConfigured, sendPush } from "@/lib/webPush";

type AdminClient = ReturnType<typeof createAdminClient>;

interface AlertRecipient {
  userId: string;
  email: string;
  // The project_alert_subscriptions row's own id, when this recipient came
  // from that table — doubles as the unsubscribe token. Recipients from
  // notifyProjectRoles (a mandatory, role-targeted notice, not an opt-in
  // subscription) have no such row and so get no unsubscribe link.
  unsubscribeId?: string;
}

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

    const recipients: AlertRecipient[] = subs
      .filter((s) => s.user_id !== options.excludeUserId)
      .map((s) => ({ userId: s.user_id, email: s.email, unsubscribeId: s.id }));

    await deliverAlert(admin, recipients, project?.name ?? "your construction", projectId, options);
  } catch (err) {
    console.warn("notifyProjectSubscribers failed (non-fatal):", err);
  }
}

// Notifies whoever's actually responsible for acting on something,
// regardless of whether they've opted into that project's alerts —
// currently just "a new warranty request needs Contractor/Developer
// review." `roles` are account-wide profiles.role values; a 'developer'
// always has access to every project (same is_developer() shortcut
// has_project_access uses), so every developer qualifies. Any other role
// (e.g. 'contractor') only qualifies if they actually have access to THIS
// project — its owner, or a project_members row on it.
export async function notifyProjectRoles(
  projectId: string,
  roles: string[],
  options: { subject: string; body: string; excludeUserId?: string }
): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: project, error: projectError }, { data: members, error: membersError }, { data: profiles, error: profilesError }] =
      await Promise.all([
        admin.from("projects").select("name, user_id").eq("id", projectId).maybeSingle(),
        admin.from("project_members").select("user_id").eq("project_id", projectId),
        admin.from("profiles").select("id, email, role").in("role", roles),
      ]);
    if (projectError) console.warn("notifyProjectRoles: could not read project:", projectError.message);
    if (membersError) console.warn("notifyProjectRoles: could not read project members:", membersError.message);
    if (profilesError) console.warn("notifyProjectRoles: could not read profiles:", profilesError.message);
    if (!profiles || profiles.length === 0) return;

    const accessibleUserIds = new Set([project?.user_id, ...(members ?? []).map((m) => m.user_id)].filter(Boolean));
    const recipients: AlertRecipient[] = profiles
      .filter((p) => p.id !== options.excludeUserId)
      // A 'developer' profile always has access (same is_developer()
      // shortcut has_project_access uses); every other role only qualifies
      // if it's actually the owner or a member of this specific project.
      .filter((p) => p.role === "developer" || accessibleUserIds.has(p.id))
      .map((p) => ({ userId: p.id, email: p.email }));

    await deliverAlert(admin, recipients, project?.name ?? "your construction", projectId, options);
  } catch (err) {
    console.warn("notifyProjectRoles failed (non-fatal):", err);
  }
}

// Shared by both dispatch paths above: emails everyone, EXCEPT a recipient
// who has at least one enabled push subscription gets pushed instead —
// "when push notifications are enabled, disable emails" for that person.
// A recipient with no push subscription (or when push isn't configured at
// all) still gets the email exactly as before.
async function deliverAlert(
  admin: AdminClient,
  recipients: AlertRecipient[],
  projectName: string,
  projectId: string,
  options: { subject: string; body: string }
): Promise<void> {
  if (recipients.length === 0) return;

  let origin: string;
  try {
    // getSiteOrigin() reads the current request's Host header (via
    // next/headers), so this only works called from within a live request —
    // true for every call site today (Server Actions triggered by a user
    // request). Falls back to a relative-looking note rather than throwing
    // if that ever changes.
    origin = getSiteOrigin();
  } catch {
    origin = "";
  }

  const pushByUser = new Map<string, { id: string; endpoint: string; p256dh: string; auth_key: string }[]>();
  if (isPushConfigured()) {
    const { data: pushSubs, error } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth_key")
      .in("user_id", recipients.map((r) => r.userId));
    if (error) {
      console.warn("deliverAlert: could not read push subscriptions:", error.message);
    } else {
      for (const sub of pushSubs ?? []) {
        const list = pushByUser.get(sub.user_id) ?? [];
        list.push(sub);
        pushByUser.set(sub.user_id, list);
      }
    }
  }

  const pushRecipients = recipients.filter((r) => pushByUser.has(r.userId));
  const emailRecipients = recipients.filter((r) => !pushByUser.has(r.userId));

  await Promise.all(
    emailRecipients.map((r) => {
      // The subscription row's own id (a random uuid) doubles as the
      // unsubscribe token — same "unguessable id in a public link" pattern
      // project_shares/project_invites already use. Recipients with no such
      // row (notifyProjectRoles) get no unsubscribe line — there's nothing
      // to unsubscribe from.
      const unsubscribeLine = r.unsubscribeId && origin
        ? `\n\nNo longer want these emails? Unsubscribe: ${origin}/api/alerts/unsubscribe?sub=${r.unsubscribeId}`
        : "";
      return sendEmail({
        to: r.email,
        subject: `${projectName}: ${options.subject}`,
        text: `${options.body}\n\n— Alaia Homes Dev.${unsubscribeLine}`,
      }).catch((err) => console.warn(`deliverAlert: failed to email ${r.email}:`, err));
    })
  );

  if (pushRecipients.length === 0) return;

  const goneIds: string[] = [];
  await Promise.all(
    pushRecipients.flatMap((r) =>
      (pushByUser.get(r.userId) ?? []).map(async (sub) => {
        const result = await sendPush(sub, {
          title: projectName,
          body: options.body.slice(0, 180),
          url: origin ? `${origin}/projects/${projectId}` : undefined,
        });
        if (!result.ok) {
          if (result.gone) goneIds.push(sub.id);
          else console.warn(`deliverAlert: failed to push to subscription ${sub.id}:`, result.error);
        }
      })
    )
  );

  // A gone subscription (the browser/OS permanently invalidated it) will
  // never succeed again — clean it up so future dispatches stop paying for
  // the failed attempt.
  if (goneIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", goneIds);
  }
}
