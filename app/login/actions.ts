"use server";

import { notifyDevelopersOfAccessRequest } from "@/lib/alerts";

// Called right after a successful self-signup (app/login/page.tsx) —
// invited/admin-created accounts never land in 'pending' status (see
// handle_new_user() in supabase/schema.sql), so this is the one path that
// actually needs a Developer's attention. Best-effort: notifyDevelopersOfAccessRequest
// already swallows its own errors, so this never surfaces a failure to the
// signup form.
export async function notifyAccessRequested(email: string, roleLabel: string): Promise<void> {
  await notifyDevelopersOfAccessRequest(email, roleLabel);
}
