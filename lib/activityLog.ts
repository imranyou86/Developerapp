import type { SupabaseClient } from "@supabase/supabase-js";

// Append-only audit trail for the highest-value "who did that?" moments —
// see supabase/migrations/038_activity_log.sql for exactly which actions
// call this and why (not every mutation in the app is logged here). Written
// with the caller's own session client (not the admin client lib/alerts.ts
// uses) since activity_log_insert's RLS already scopes writes correctly
// (has_project_access + auth.uid() = user_id) and there's no cross-user
// read needed the way alert dispatch has. Never throws — a logging failure
// should never block the action it's describing.
export async function logActivity(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    userId: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    detail?: string;
  }
): Promise<void> {
  try {
    await supabase.from("activity_log").insert({
      project_id: input.projectId,
      user_id: input.userId,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      detail: input.detail ?? null,
    });
  } catch (err) {
    console.error(`logActivity failed for "${input.action}" on project ${input.projectId}:`, err);
  }
}
