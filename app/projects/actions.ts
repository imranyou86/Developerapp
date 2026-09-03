"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CHECKLIST_SEED } from "@/lib/checklist-seed";

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

export async function createProject(name: string, address: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!name.trim()) return { ok: false, error: "Name is required." };

  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: user.id, name: name.trim(), address: address.trim() || null })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  // Seed the standard checklist immediately so the Checklist tab is never empty.
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

  revalidatePath("/projects");
  return { ok: true, id: data.id };
}

export async function renameProject(id: string, name: string, address: string): Promise<ActionResult> {
  const supabase = createClient();
  if (!name.trim()) return { ok: false, error: "Name is required." };

  const { error } = await supabase
    .from("projects")
    .update({ name: name.trim(), address: address.trim() || null })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/projects");
  return { ok: true };
}
