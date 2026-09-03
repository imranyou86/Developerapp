import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
