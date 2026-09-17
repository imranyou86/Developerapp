"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CHECKLIST_SEED } from "@/lib/checklist-seed";
import type { ProjectKind } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

// Only a Developer or Contractor can create, rename, or delete a
// construction — checked here for a clear error message AND, since this
// is a real authorization boundary, directly in RLS too (can_manage_projects()
// in supabase/schema.sql), the same defense-in-depth pattern
// requireDeveloper()/requireApprover() use elsewhere.
async function requireCanManageProjects(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "developer" && profile?.role !== "contractor") {
    return { ok: false, error: "Only a Developer or Contractor can manage constructions." };
  }
  return { ok: true, userId: user.id };
}

export async function createProject(name: string, address: string, kind: ProjectKind = "construction"): Promise<ActionResult> {
  const guard = await requireCanManageProjects();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!name.trim()) return { ok: false, error: "Name is required." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: guard.userId, name: name.trim(), address: address.trim() || null, kind })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  // A warranty tracker never sees the Checklist tab (see the layout's tab
  // restriction), so the rough-in/finish QA seed would just be dead rows.
  if (kind === "construction") {
    const seedRows = CHECKLIST_SEED.map((item, i) => ({
      project_id: data.id,
      phase: item.phase,
      title: item.title,
      sort_order: i,
    }));
    const { error: seedError } = await supabase.from("checklist_items").insert(seedRows);
    if (seedError) {
      return { ok: false, error: `Project created, but checklist seed failed: ${seedError.message}` };
    }
  }

  revalidatePath("/projects");
  return { ok: true, id: data.id };
}

export async function renameProject(id: string, name: string, address: string): Promise<ActionResult> {
  const guard = await requireCanManageProjects();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!name.trim()) return { ok: false, error: "Name is required." };

  const supabase = createClient();
  const { error } = await supabase
    .from("projects")
    .update({ name: name.trim(), address: address.trim() || null })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const guard = await requireCanManageProjects();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/projects");
  return { ok: true };
}
