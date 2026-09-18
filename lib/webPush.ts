// Server-only. Thin wrapper around the `web-push` package, matching this
// app's other external-API wrappers (lib/email.ts, lib/anthropic.ts) — one
// function per operation, configured lazily from env vars, throws/reports
// failure rather than silently swallowing it (the caller, lib/alerts.ts,
// is what actually treats a failure as non-fatal).

import webpush from "web-push";

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

let configured = false;

// The public key is the same NEXT_PUBLIC_VAPID_PUBLIC_KEY the client uses
// to subscribe (components/PushNotificationToggle.tsx) — it's not a
// secret, so one env var serves both instead of duplicating the same
// value under a public and a server-only name.
export function isPushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function ensureConfigured(): void {
  if (configured || !isPushConfigured()) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:support@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  configured = true;
}

// A 404/410 means the browser/OS has permanently invalidated this
// subscription (uninstalled, permission revoked, endpoint expired) — the
// caller should delete the row rather than keep retrying it forever.
export async function sendPush(sub: PushSubscriptionRow, payload: PushPayload): Promise<{ ok: boolean; gone: boolean; error?: string }> {
  if (!isPushConfigured()) return { ok: false, gone: false, error: "Push notifications are not configured on the server." };
  ensureConfigured();

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      JSON.stringify(payload)
    );
    return { ok: true, gone: false };
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    const gone = statusCode === 404 || statusCode === 410;
    return { ok: false, gone, error: err instanceof Error ? err.message : String(err) };
  }
}
