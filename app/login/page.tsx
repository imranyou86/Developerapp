"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/BrandMark";
import { notifyAccessRequested } from "@/app/login/actions";
import { ROLE_LABELS } from "@/lib/permissions";

type Mode = "password" | "magic-link" | "sign-up";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/projects";

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"owner" | "pm" | "contractor">("owner");
  const [status, setStatus] = useState<{ kind: "idle" | "loading" | "error" | "sent"; message?: string }>({
    kind: "idle",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "loading" });
    const supabase = createClient();

    if (mode === "magic-link") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "sent", message: "Check your email for a sign-in link." });
      }
      return;
    }

    if (mode === "sign-up") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
          data: { role },
        },
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "sent", message: "Check your email to confirm your account." });
        // Fire-and-forget — a Developer gets a push/email the moment someone
        // requests access, instead of only finding out next time they happen
        // to check Admin. Best-effort (notifyAccessRequested never throws),
        // so a slow/failed call here never affects what the signup form shows.
        notifyAccessRequested(email, ROLE_LABELS[role]).catch(() => {});
      }
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus({ kind: "error", message: error.message });
      return;
    }
    // A one-time welcome overlay (components/WelcomeOverlay.tsx, rendered
    // from app/projects/page.tsx) reads this query flag on landing and
    // strips it right away, so it only ever shows immediately after a
    // real sign-in, never on an ordinary page load/refresh.
    //
    // Uses the Next.js router, not window.location.href — a raw browser
    // navigation reassigned after this `await` (outside the split-second
    // "direct user gesture" window Safari tracks) can get treated like a
    // delayed pop-under and silently blocked when "Block Pop-ups" is on.
    // A client-side router transition never goes through that check at
    // all. @supabase/ssr's browser client writes the session to real
    // cookies (not just localStorage), so /projects's server component —
    // already force-dynamic — sees the fresh session on this navigation
    // without needing a full page reload.
    const separator = next.includes("?") ? "&" : "?";
    router.push(`${next}${separator}welcome=1`);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-concrete px-4">
      {/* Soft radial glow + a faint blueprint grid behind the card — purely
          decorative, so it's aria-hidden and pointer-events-none rather than
          part of the page's actual content. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-[-10%] h-[560px] w-[560px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(31,58,95,0.18), transparent 70%)" }}
        />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(#1F3A5F 1px, transparent 1px), linear-gradient(90deg, #1F3A5F 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      <div className="relative w-full max-w-sm animate-fade-in-up">
        <div className="mb-8 text-center">
          <BrandMark size="lg" className="mx-auto mb-3 animate-scale-in" />
          <h1 className="text-xl font-semibold text-blueprint-dark">Alaia Homes Dev</h1>
          <p className="mt-1 text-sm text-blueprint/60">Construction project management</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6">
          <div key={mode} className="animate-fade-in space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            {mode !== "magic-link" && (
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}

            {mode === "sign-up" && (
              <div>
                <label className="label" htmlFor="role">
                  Login type
                </label>
                <select
                  id="role"
                  className="input"
                  value={role}
                  onChange={(e) => setRole(e.target.value as typeof role)}
                >
                  <option value="owner">Owner</option>
                  <option value="pm">PM</option>
                  <option value="contractor">Contractor</option>
                </select>
                <p className="mt-1 text-xs text-blueprint/40">
                  A Developer account is granted by an existing Developer, not chosen here.
                </p>
              </div>
            )}
          </div>

          {status.kind === "error" && <p className="animate-fade-in text-sm text-red-600">{status.message}</p>}
          {status.kind === "sent" && <p className="animate-fade-in text-sm text-sage-dark">{status.message}</p>}

          <button type="submit" className="btn-primary w-full" disabled={status.kind === "loading"}>
            {status.kind === "loading"
              ? "Please wait…"
              : mode === "magic-link"
                ? "Send magic link"
                : mode === "sign-up"
                  ? "Create account"
                  : "Sign in"}
          </button>

          <div className="flex items-center justify-between text-xs text-blueprint/60">
            {mode === "password" ? (
              <>
                <button type="button" className="transition-colors hover:text-amber" onClick={() => setMode("sign-up")}>
                  Create an account
                </button>
                <button
                  type="button"
                  className="transition-colors hover:text-amber"
                  onClick={() => setMode("magic-link")}
                >
                  Use a magic link instead
                </button>
              </>
            ) : (
              <button type="button" className="transition-colors hover:text-amber" onClick={() => setMode("password")}>
                Back to password sign-in
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
