import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// redirect() from next/navigation issues a 307 by default in a plain Route
// Handler, which preserves the original request method — since this is
// triggered by a raw <form method="post">, the browser would then re-issue
// a POST to /login, a page with no POST handler, and fail. A manual 303
// forces the browser to follow up with a GET instead.
export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
