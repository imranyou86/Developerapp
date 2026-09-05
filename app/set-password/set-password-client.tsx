"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/BrandMark";

export function SetPasswordClient({ email, next }: { email: string; next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "loading" | "error"; message?: string }>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setStatus({ kind: "error", message: "Password must be at least 6 characters." });
      return;
    }
    if (password !== confirm) {
      setStatus({ kind: "error", message: "Passwords don't match." });
      return;
    }

    setStatus({ kind: "loading" });
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus({ kind: "error", message: error.message });
      return;
    }
    router.push(next);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-concrete px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandMark size="lg" className="mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-blueprint-dark">Set a password</h1>
          <p className="mt-1 text-sm text-blueprint/60">
            You&apos;re signed in as {email}. Set a password so you can sign back in directly next time — or skip
            and keep using emailed links.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="new-password">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={6}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="label" htmlFor="confirm-password">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              required
              minLength={6}
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {status.kind === "error" && <p className="text-sm text-red-600">{status.message}</p>}

          <button type="submit" className="btn-primary w-full" disabled={status.kind === "loading"}>
            {status.kind === "loading" ? "Saving…" : "Set password & continue"}
          </button>

          <button type="button" className="w-full text-center text-xs text-blueprint/60 hover:text-amber" onClick={() => router.push(next)}>
            Skip for now
          </button>
        </form>
      </div>
    </div>
  );
}
