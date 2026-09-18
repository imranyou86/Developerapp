// Server-only. Fires an alert whenever something worth knowing about
// happens on a project — a chat message, a checklist/warranty item added
// or marked fixed, a warranty item's review status changing, and so on.
// Every call site goes through notifyForAction(projectId, actionKey, ...),
// which looks up that action's row in notification_settings (Developer-
// editable from the Admin page's Notifications section) to decide two
// things: whether this notification fires at all, and which roles get it
// regardless of their own "Get alerts" opt-in. See
// lib/notificationCatalog.ts for the canonical action list and what each
// one means.
//
// Reads subscribers/settings/profiles via the service-role admin client
// (lib/supabase/admin.ts) rather than the caller's own session —
// project_alert_subscriptions_select and notification_settings_select
// only allow a user to see their own row (or, for settings, require
// Developer), since dispatch is a system operation, not something any one
// caller should be able to read other members' rows through. Best-effort
// throughout: a broken RESEND_API_KEY/VAPID key or a delivery failure
// never breaks the action that triggered the alert — see every catch
// below.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { getSiteOrigin } from "@/lib/site";
import { isPushConfigured, sendPush } from "@/lib/webPush";
import { NOTIFICATION_ACTIONS } from "@/lib/notificationCatalog";

type AdminClient = ReturnType<typeof createAdminClient>;

interface AlertRecipient {
  userId: string;
  email: string;
  // The project_alert_subscriptions row's own id, when this recipient came
  // from that table — doubles as the unsubscribe token. A recipient who
  // only qualifies via notification_settings' forced roles (not a personal
  // subscription) has no such row and so gets no unsubscribe link — there
  // being nothing they personally subscribed to.
  unsubscribeId?: string;
}

export async function notifyForAction(
  projectId: string,
  action: string,
  options: { subject: string; body: string; excludeUserId?: string; alwaysIncludeUserId?: string }
): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: setting, error: settingError }, { data: subs, error: subsError }, { data: project, error: projectError }] =
      await Promise.all([
        admin.from("notification_settings").select("enabled, roles").eq("action", action).maybeSingle(),
        admin.from("project_alert_subscriptions").select("id, user_id, email").eq("project_id", projectId),
        admin.from("projects").select("name, user_id").eq("id", projectId).maybeSingle(),
      ]);
    if (settingError) console.warn(`notifyForAction(${action}): could not read notification_settings:`, settingError.message);
    if (subsError) console.warn(`notifyForAction(${action}): could not read subscribers:`, subsError.message);
    if (projectError) console.warn(`notifyForAction(${action}): could not read project:`, projectError.message);

    // No row yet (a fresh action added to the catalog before its migration
    // seed ran, or the settings table itself missing) falls back to that
    // action's catalog default rather than silently going quiet.
    const catalogDefault = NOTIFICATION_ACTIONS.find((a) => a.key === action);
    const enabled = setting?.enabled ?? true;
    const roles = setting?.roles ?? catalogDefault?.defaultRoles ?? [];
    if (!enabled) return;

    const recipientsByUser = new Map<string, AlertRecipient>();

    for (const s of subs ?? []) {
      if (s.user_id === options.excludeUserId) continue;
      recipientsByUser.set(s.user_id, { userId: s.user_id, email: s.email, unsubscribeId: s.id });
    }

    if (roles.length > 0) {
      const [{ data: members, error: membersError }, { data: profiles, error: profilesError }] = await Promise.all([
        admin.from("project_members").select("user_id").eq("project_id", projectId),
        admin.from("profiles").select("id, email, role").in("role", roles),
      ]);
      if (membersError) console.warn(`notifyForAction(${action}): could not read project members:`, membersError.message);
      if (profilesError) console.warn(`notifyForAction(${action}): could not read profiles:`, profilesError.message);

      const accessibleUserIds = new Set([project?.user_id, ...(members ?? []).map((m) => m.user_id)].filter(Boolean));
      for (const p of profiles ?? []) {
        if (p.id === options.excludeUserId) continue;
        // A 'developer' profile always has access (same is_developer()
        // shortcut has_project_access uses); every other role only
        // qualifies if it's actually the owner or a member of this project.
        if (p.role !== "developer" && !accessibleUserIds.has(p.id)) continue;
        // A personal subscription (added above) already carries an
        // unsubscribe link — don't overwrite it with a forced-role entry
        // that has none.
        if (!recipientsByUser.has(p.id)) recipientsByUser.set(p.id, { userId: p.id, email: p.email });
      }
    }

    // A specific recipient who must always be notified regardless of their
    // own subscription or forced-role membership — e.g. the homeowner whose
    // warranty request just got a scheduled visit. Still respects the
    // enabled toggle and excludeUserId above; it just bypasses the
    // subscription/role membership checks the rest of this function relies on.
    if (
      options.alwaysIncludeUserId &&
      options.alwaysIncludeUserId !== options.excludeUserId &&
      !recipientsByUser.has(options.alwaysIncludeUserId)
    ) {
      const { data: profile } = await admin.from("profiles").select("id, email").eq("id", options.alwaysIncludeUserId).maybeSingle();
      if (profile) recipientsByUser.set(profile.id, { userId: profile.id, email: profile.email });
    }

    const recipients = Array.from(recipientsByUser.values());
    await deliverAlert(admin, recipients, project?.name ?? "your construction", projectId, options);
  } catch (err) {
    console.warn(`notifyForAction(${action}) failed (non-fatal):`, err);
  }
}

// Shared by notifyForAction: emails everyone, EXCEPT a recipient who has
// at least one enabled push subscription gets pushed instead — "when push
// notifications are enabled, disable emails" for that person. A recipient
// with no push subscription (or when push isn't configured at all) still
// gets the email exactly as before.
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
      // project_shares/project_invites already use. A recipient with no
      // such id (forced by role, not personally subscribed) gets no
      // unsubscribe line — there's nothing to unsubscribe from.
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
