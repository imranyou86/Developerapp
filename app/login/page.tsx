"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "magic-link" | "sign-up";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/projects";

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "sent", message: "Check your email to confirm your account." });
      }
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus({ kind: "error", message: error.message });
      return;
    }
    window.location.href = next;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-concrete px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blueprint text-lg font-bold text-white">
            TD
          </div>
          <h1 className="text-xl font-semibold text-blueprint-dark">The Developer</h1>
          <p className="mt-1 text-sm text-blueprint/60">Construction project management</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6">
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

          {status.kind === "error" && <p className="text-sm text-red-600">{status.message}</p>}
          {status.kind === "sent" && <p className="text-sm text-sage-dark">{status.message}</p>}

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
                <button type="button" className="hover:text-amber" onClick={() => setMode("sign-up")}>
                  Create an account
                </button>
                <button type="button" className="hover:text-amber" onClick={() => setMode("magic-link")}>
                  Use a magic link instead
                </button>
              </>
            ) : (
              <button type="button" className="hover:text-amber" onClick={() => setMode("password")}>
                Back to password sign-in
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
