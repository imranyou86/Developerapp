"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import {
  sendProjectInvite,
  revokeInvite,
  removeMember,
  listProjectInvitesAndMembers,
  type ProjectInviteRow,
  type ProjectMemberRow,
} from "@/app/projects/[id]/invite-actions";
import { ROLE_LABELS } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

// Developer isn't an invitable project role — a real Developer account
// already has full access to every project via is_developer(), so tagging
// a project_members row "developer" would just be a confusing label with
// no actual admin effect (that only comes from profiles.role, editable on
// the Admin page's Users section).
const INVITABLE_ROLES: UserRole[] = ["owner", "pm", "contractor"];

export function InviteButton({ projectId }: { projectId: string }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [invites, setInvites] = useState<ProjectInviteRow[]>([]);
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("contractor");
  const [sending, startSending] = useTransition();
  const [removing, setRemoving] = useState<{ kind: "invite" | "member"; id: string } | null>(null);

  async function refresh() {
    const res = await listProjectInvitesAndMembers(projectId);
    setInvites(res.invites);
    setMembers(res.members);
    setLoaded(true);
  }

  function handleOpen() {
    setOpen(true);
    if (!loaded) refresh();
  }

  function inviteUrl(token: string): string {
    if (typeof window === "undefined") return `/invite/${token}`;
    return `${window.location.origin}/invite/${token}`;
  }

  async function handleCopy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      notify("success", "Invite link copied — send it to them however you like.");
    } catch {
      notify("error", "Could not copy — copy it manually from the field.");
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    startSending(async () => {
      const res = await sendProjectInvite(projectId, email, role);
      if (!res.ok) {
        notify("error", res.error ?? "Could not send invite.");
        return;
      }
      notify("success", `Invite created for ${email}. Copy the link below to send it.`);
      setEmail("");
      await refresh();
    });
  }

  return (
    <>
      <button className="btn-outline shrink-0 text-xs" onClick={handleOpen}>
        Invite
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Invite someone to this construction"
        footer={
          <button className="btn-outline" onClick={() => setOpen(false)}>
            Done
          </button>
        }
      >
        <div className="space-y-5">
          <p className="text-sm text-blueprint/70">
            Invite a person to this project at a specific role. There&apos;s no email sending configured yet, so
            copy the invite link after creating it and send it to them yourself — they&apos;ll get access once
            they sign in with the matching email and open the link.
          </p>

          <form onSubmit={handleSend} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label className="label" htmlFor="invite-email">
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <div>
              <label className="label" htmlFor="invite-role">
                Role
              </label>
              <select
                id="invite-role"
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
              >
                {INVITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-amber" disabled={sending}>
              {sending ? "Sending…" : "Invite"}
            </button>
          </form>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blueprint/50">Members</h3>
            {members.length === 0 ? (
              <p className="text-sm text-blueprint/50">No invited members yet — just the project owner.</p>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-lg border border-blueprint/10 p-2 text-sm">
                    <span className="flex-1 truncate">{m.email ?? m.user_id}</span>
                    <span className="badge-amber text-xs">{ROLE_LABELS[m.role]}</span>
                    <button
                      className="text-xs text-red-500 hover:underline"
                      onClick={() => setRemoving({ kind: "member", id: m.id })}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blueprint/50">Pending invites</h3>
            {invites.filter((i) => i.status === "pending").length === 0 ? (
              <p className="text-sm text-blueprint/50">No pending invites.</p>
            ) : (
              <div className="space-y-2">
                {invites
                  .filter((i) => i.status === "pending")
                  .map((i) => (
                    <div key={i.id} className="space-y-1 rounded-lg border border-blueprint/10 p-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="flex-1 truncate">{i.email}</span>
                        <span className="badge-amber text-xs">{ROLE_LABELS[i.role]}</span>
                        <button
                          className="text-xs text-red-500 hover:underline"
                          onClick={() => setRemoving({ kind: "invite", id: i.id })}
                        >
                          Revoke
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input className="input flex-1 text-xs" readOnly value={inviteUrl(i.token)} onFocus={(e) => e.target.select()} />
                        <button className="btn-ghost text-xs" onClick={() => handleCopy(i.token)}>
                          Copy
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        title={removing?.kind === "invite" ? "Revoke invite?" : "Remove member?"}
        message={
          removing?.kind === "invite"
            ? "This invite link will stop working. This cannot be undone — you'd need to send a new invite."
            : "They will immediately lose access to this construction."
        }
        confirmLabel={removing?.kind === "invite" ? "Revoke" : "Remove"}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const res =
            removing.kind === "invite"
              ? await revokeInvite(removing.id, projectId)
              : await removeMember(removing.id, projectId);
          if (!res.ok) {
            notify("error", res.error ?? "Could not complete that action.");
          } else {
            notify("success", removing.kind === "invite" ? "Invite revoked." : "Member removed.");
            await refresh();
          }
          setRemoving(null);
        }}
      />
    </>
  );
}
