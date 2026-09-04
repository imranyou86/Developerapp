"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_ROLE_COOKIE, ROLE_VALUES } from "@/lib/permissions";
import type { ActionResult } from "@/app/projects/actions";
import type { UserRole } from "@/lib/types";

// Lets a Developer browse the app as another role would see it (which
// tabs/pages render) without touching their real account role — a
// session cookie only a real Developer's own profile row can set (checked
// server-side here, not just trusted from the client), cleared by passing
// role: null.
export async function setPreviewRole(role: UserRole | null): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "developer") return { ok: false, error: "Only a Developer can preview other roles." };

  const store = cookies();
  if (role === null || role === "developer" || !ROLE_VALUES.includes(role)) {
    store.delete(PREVIEW_ROLE_COOKIE);
  } else {
    // Session cookie (no maxAge) — clears itself when the browser closes,
    // so a Developer can't accidentally stay stuck previewing for days.
    store.set(PREVIEW_ROLE_COOKIE, role, { path: "/", sameSite: "lax", httpOnly: true });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
