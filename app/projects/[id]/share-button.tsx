"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { createShareLink, revokeShareLink } from "@/app/projects/[id]/share-actions";

interface ShareRow {
  id: string;
  token: string;
  created_at: string;
  revoked_at: string | null;
}

export function ShareButton({ projectId, initialShares }: { projectId: string; initialShares: ShareRow[] }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareRow[]>(initialShares);
  const [creating, startCreating] = useTransition();
  const [revoking, setRevoking] = useState<ShareRow | null>(null);

  function shareUrl(token: string): string {
    if (typeof window === "undefined") return `/share/${token}`;
    return `${window.location.origin}/share/${token}`;
  }

  async function handleCopy(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      notify("success", "Link copied.");
    } catch {
      notify("error", "Could not copy — copy it manually from the field.");
    }
  }

  function handleCreate() {
    startCreating(async () => {
      const res = await createShareLink(projectId);
      if (!res.ok || !res.token || !res.id) {
        notify("error", res.error ?? "Could not create share link.");
        return;
      }
      setShares((prev) => [{ id: res.id!, token: res.token!, created_at: new Date().toISOString(), revoked_at: null }, ...prev]);
      notify("success", "Share link created.");
    });
  }

  return (
    <>
      <button className="btn-outline shrink-0 text-xs" onClick={() => setOpen(true)}>
        Share
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Share this construction"
        footer={
          <button className="btn-outline" onClick={() => setOpen(false)}>
            Done
          </button>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-blueprint/70">
            Anyone with a link below can view this construction — plan, rooms, tasks, checklist,
            budget, and payments — without an account. Share it with a project manager, the
            owner, or other staff. Revoke a link anytime to cut off access.
          </p>

          {shares.length === 0 ? (
            <p className="text-sm text-blueprint/50">No active share links yet.</p>
          ) : (
            <div className="space-y-2">
              {shares.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border border-blueprint/10 p-2">
                  <input className="input flex-1 text-xs" readOnly value={shareUrl(s.token)} onFocus={(e) => e.target.select()} />
                  <button className="btn-ghost text-xs" onClick={() => handleCopy(s.token)}>
                    Copy
                  </button>
                  <button className="text-xs text-red-500 hover:underline" onClick={() => setRevoking(s)}>
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}

          <button className="btn-amber w-full" onClick={handleCreate} disabled={creating}>
            {creating ? "Creating…" : "+ Create new share link"}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!revoking}
        title="Revoke share link?"
        message="Anyone using this link will immediately lose access. This cannot be undone — you'd need to create a new link."
        confirmLabel="Revoke"
        danger
        onCancel={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          const res = await revokeShareLink(projectId, revoking.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not revoke link.");
          } else {
            setShares((prev) => prev.filter((s) => s.id !== revoking.id));
            notify("success", "Share link revoked.");
          }
          setRevoking(null);
        }}
      />
    </>
  );
}
