import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// One-click unsubscribe from an alert email, no sign-in required — the
// subscription row's own id (a random uuid) doubles as the unsubscribe
// token, same "unguessable id in a public link" pattern project_shares and
// project_invites already use for their own tokens. Uses the admin client
// since a link clicked from an email client carries no session — matches
// notifyProjectSubscribers' own read of this table for the same reason.
export async function GET(req: Request) {
  const subscriptionId = new URL(req.url).searchParams.get("sub");
  if (!subscriptionId) {
    return htmlResponse("Missing unsubscribe link. Please use the link exactly as it appeared in the email.", 400);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("project_alert_subscriptions")
    .delete()
    .eq("id", subscriptionId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("alerts/unsubscribe failed:", error.message);
    return htmlResponse("Something went wrong. Please try again from the construction's page instead.", 500);
  }
  if (!data) {
    // Already unsubscribed (or an invalid link) — same friendly message
    // either way, since there's nothing actionable left to tell them.
    return htmlResponse("You're unsubscribed — no further alert emails will be sent for this construction.");
  }

  return htmlResponse("You're unsubscribed — no further alert emails will be sent for this construction.");
}

function htmlResponse(message: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Unsubscribed — Alaia Homes Dev</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f4f3f1; color: #1e293b; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 24px; }
  .card { background: #fff; border-radius: 12px; padding: 32px; max-width: 420px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  p { line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <p>${message}</p>
  </div>
</body>
</html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
