"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Supabase's default "Invite user" email template (unless customized to use
// this app's token_hash-based /auth/confirm route, like Magic Link/Signup
// already are) links straight to this page with session tokens in the URL
// *fragment* (`#access_token=...`) rather than a query param — fragments
// never reach the server, so the server component's cookie-based
// getUser() sees nobody signed in even though the browser just got a valid
// session. This bridges that: the browser Supabase client processes the
// fragment on mount (detectSessionInUrl) and persists it to cookies, then
// we reload the same URL without the fragment so the server component's
// next request actually has that session to read.
export function HashSessionBridge({ token }: { token: string }) {
  const router = useRouter();
  const [noSessionFound, setNoSessionFound] = useState(false);

  useEffect(() => {
    const hasHashTokens = window.location.hash.includes("access_token");
    if (!hasHashTokens) {
      setNoSessionFound(true);
      return;
    }
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        window.location.replace(window.location.pathname + window.location.search);
      } else {
        setNoSessionFound(true);
      }
    });
  }, []);

  useEffect(() => {
    if (noSessionFound) {
      router.replace(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
    }
  }, [noSessionFound, router, token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-concrete px-4">
      <p className="text-sm text-blueprint/50">Signing you in…</p>
    </div>
  );
}
