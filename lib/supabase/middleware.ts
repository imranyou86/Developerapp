import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

export async function updateSession(request: NextRequest) {
  // Public, unauthenticated read-only project share pages — no session
  // lookup needed at all, and never redirected to /login.
  if (request.nextUrl.pathname.startsWith("/share")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/auth");
  const isPublicAsset = path.startsWith("/_next") || path.startsWith("/favicon");
  const isPendingApprovalRoute = path.startsWith("/pending-approval");

  if (!user && !isAuthRoute && !isPublicAsset) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/projects";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Signing up alone doesn't grant access — a Developer has to approve the
  // account from Admin's "Access requests" section first. Checked here
  // (rather than per-page) so every route is covered by one gate. A missing
  // profile row is treated as not-yet-approved rather than defaulting open,
  // since the trigger that creates it runs synchronously on signup and
  // shouldn't normally be missing.
  if (user && !isAuthRoute && !isPublicAsset && !isPendingApprovalRoute) {
    const { data: profile } = await supabase.from("profiles").select("status").eq("id", user.id).maybeSingle();
    if (profile?.status !== "approved") {
      const url = request.nextUrl.clone();
      url.pathname = "/pending-approval";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (user && isPendingApprovalRoute) {
    const { data: profile } = await supabase.from("profiles").select("status").eq("id", user.id).maybeSingle();
    if (profile?.status === "approved") {
      const url = request.nextUrl.clone();
      url.pathname = "/projects";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
