"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { updateTabPermission, updateUserRole, updateUserStatus, deleteUser, resetUserPassword } from "@/app/admin/actions";
import { setPreviewRole } from "@/app/admin/preview-actions";
import {
  sendProjectInvite,
  revokeInvite,
  removeMember,
  listProjectInvitesAndMembers,
  type ProjectInviteRow,
  type ProjectMemberRow,
} from "@/app/projects/[id]/invite-actions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ROLE_LABELS, ROLE_VALUES } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

const PREVIEWABLE_ROLES: UserRole[] = ["owner", "pm", "contractor"];

// Inviting someone as "Developer" is a special case, handled on accept
// (see app/invite/[token]/page.tsx) — it promotes their account role to
// developer (full admin access everywhere), not just membership on this
// one project. A user's role can also be changed directly in the Users
// section above without going through an invite at all.
const INVITABLE_ROLES: UserRole[] = ["owner", "pm", "contractor", "developer"];

export type AccountStatus = "pending" | "approved" | "rejected";

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
}

export interface AdminProject {
  id: string;
  name: string;
  address: string | null;
  ownerId: string;
  ownerEmail: string;
}

interface MatrixRole {
  role: UserRole;
  tabs: { slug: string; label: string; allowed: boolean }[];
}

export function AdminClient({
  matrix,
  users,
  projects,
  currentUserId,
  currentPreviewRole,
}: {
  matrix: MatrixRole[];
  users: AdminUser[];
  projects: AdminProject[];
  currentUserId: string;
  /** Effective role right now — "developer" means no preview active. */
  currentPreviewRole: UserRole;
}) {
  const [rows, setRows] = useState(users);

  return (
    <div className="space-y-10">
      <AccessRequestsSection rows={rows} setRows={setRows} currentUserId={currentUserId} />
      <PreviewRoleSection currentPreviewRole={currentPreviewRole} />
      <TabPermissionMatrix initial={matrix} />
      <UsersSection rows={rows} setRows={setRows} projects={projects} currentUserId={currentUserId} />
      <ProjectsSection projects={projects} />
    </div>
  );
}

function AccessRequestsSection({
  rows,
  setRows,
  currentUserId,
}: {
  rows: AdminUser[];
  setRows: React.Dispatch<React.SetStateAction<AdminUser[]>>;
  currentUserId: string;
}) {
  const { notify } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = rows.filter((u) => u.status === "pending" && u.id !== currentUserId);

  async function decide(userId: string, status: AccountStatus) {
    setBusyId(userId);
    const res = await updateUserStatus(userId, status);
    setBusyId(null);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update access.");
      return;
    }
    setRows((r) => r.map((u) => (u.id === userId ? { ...u, status } : u)));
    notify("success", status === "approved" ? "Access granted." : "Access declined.");
  }

  if (pending.length === 0) return null;

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">
        Access requests <span className="badge-amber ml-1 text-xs">{pending.length}</span>
      </h2>
      <p className="mb-3 text-xs text-blueprint/50">
        New accounts created via the sign-up form on /login can&apos;t use the app until a Developer approves them
        here — this prevents anyone who finds the sign-up page from getting free access.
      </p>
      <div className="space-y-2">
        {pending.map((u) => (
          <div key={u.id} className="flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/5 p-2 text-sm">
            <span className="flex-1 truncate">{u.email}</span>
            <span className="badge-amber text-xs">{ROLE_LABELS[u.role]}</span>
            <button
              className="btn-primary px-3 py-1 text-xs"
              disabled={busyId === u.id}
              onClick={() => decide(u.id, "approved")}
            >
              Approve
            </button>
            <button
              className="text-xs text-red-500 hover:underline"
              disabled={busyId === u.id}
              onClick={() => decide(u.id, "rejected")}
            >
              Decline
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PreviewRoleSection({ currentPreviewRole }: { currentPreviewRole: UserRole }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const previewing = currentPreviewRole !== "developer";

  function handleChange(value: string) {
    startTransition(async () => {
      await setPreviewRole(value === "developer" ? null : (value as UserRole));
      router.refresh();
    });
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">Preview as another role</h2>
      <p className="mb-3 text-xs text-blueprint/50">
        Browse the rest of the app as Owner/PM/Contractor would see it — which tabs render, whether Buyers
        Guide/Interior Design even show up in the nav — without a second test account or touching your real role.
        It only changes what&apos;s shown to you: your Developer account keeps full data access underneath, and
        this Admin page always stays reachable regardless of what you&apos;re previewing. Come back here to turn
        it off.
      </p>
      <div className="flex items-center gap-2">
        <select
          className="input w-auto"
          value={previewing ? currentPreviewRole : "developer"}
          disabled={pending}
          onChange={(e) => handleChange(e.target.value)}
        >
          <option value="developer">Not previewing</option>
          {PREVIEWABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        {previewing && <span className="badge-amber text-xs">Previewing as {ROLE_LABELS[currentPreviewRole]}</span>}
      </div>
    </section>
  );
}

function TabPermissionMatrix({ initial }: { initial: MatrixRole[] }) {
  const { notify } = useToast();
  const [matrix, setMatrix] = useState(initial);

  async function toggle(role: UserRole, slug: string, next: boolean) {
    setMatrix((prev) =>
      prev.map((row) =>
        row.role !== role
          ? row
          : { ...row, tabs: row.tabs.map((t) => (t.slug === slug ? { ...t, allowed: next } : t)) }
      )
    );
    const res = await updateTabPermission(role, slug, next);
    if (!res.ok) {
      notify("error", res.error ?? "Could not save.");
      setMatrix((prev) =>
        prev.map((row) =>
          row.role !== role
            ? row
            : { ...row, tabs: row.tabs.map((t) => (t.slug === slug ? { ...t, allowed: !next } : t)) }
        )
      );
    }
  }

  const tabDefs = matrix[0]?.tabs ?? [];

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">Tab permissions</h2>
      <p className="mb-3 text-xs text-blueprint/50">
        Choose which project tabs each role can see. Developer always has full access to every tab.
      </p>
      <div className="overflow-x-auto rounded-lg border border-blueprint/10 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-blueprint/10 text-left text-xs text-blueprint/50">
              <th className="px-3 py-2 font-medium">Role</th>
              {tabDefs.map((t) => (
                <th key={t.slug} className="px-3 py-2 text-center font-medium">
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.role} className="border-b border-blueprint/5 last:border-0">
                <td className="px-3 py-2 font-medium text-blueprint-dark">{ROLE_LABELS[row.role]}</td>
                {row.tabs.map((t) => (
                  <td key={t.slug} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={t.allowed}
                      onChange={(e) => toggle(row.role, t.slug, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const STATUS_LABELS: Record<AccountStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Declined",
};

function UsersSection({
  rows,
  setRows,
  projects,
  currentUserId,
}: {
  rows: AdminUser[];
  setRows: React.Dispatch<React.SetStateAction<AdminUser[]>>;
  projects: AdminProject[];
  currentUserId: string;
}) {
  const { notify } = useToast();
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [resettingPasswordFor, setResettingPasswordFor] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleChange(userId: string, role: UserRole) {
    const prev = rows;
    setRows((r) => r.map((u) => (u.id === userId ? { ...u, role } : u)));
    const res = await updateUserRole(userId, role);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update role.");
      setRows(prev);
    } else {
      notify("success", "Role updated.");
    }
  }

  async function handleStatusChange(userId: string, status: AccountStatus) {
    const prev = rows;
    setRows((r) => r.map((u) => (u.id === userId ? { ...u, status } : u)));
    const res = await updateUserStatus(userId, status);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update access.");
      setRows(prev);
    } else {
      notify("success", "Access updated.");
    }
  }

  function ownedProjectCount(userId: string): number {
    return projects.filter((p) => p.ownerId === userId).length;
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">Users</h2>
      <p className="mb-3 text-xs text-blueprint/50">
        Change anyone&apos;s account-level login type, including granting Developer access. Access controls whether
        they can use the app at all — set it back to Pending or Declined to revoke access from someone already
        approved. &quot;Reset password&quot; sets a new password directly, for when someone&apos;s locked out and
        can&apos;t use email-based recovery themselves.
      </p>
      <div className="space-y-2">
        {rows.map((u) => (
          <div key={u.id} className="flex items-center gap-2 rounded-lg border border-blueprint/10 bg-white p-2 text-sm">
            <span className="flex-1 truncate">
              {u.email}
              {u.id === currentUserId && <span className="ml-2 text-xs text-blueprint/40">(you)</span>}
            </span>
            {u.status !== "approved" && (
              <span className={`text-xs ${u.status === "rejected" ? "text-red-500" : "text-amber-600"}`}>
                {STATUS_LABELS[u.status]}
              </span>
            )}
            <select className="input w-auto text-xs" value={u.role} onChange={(e) => handleChange(u.id, e.target.value as UserRole)}>
              {ROLE_VALUES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            {u.id !== currentUserId && (
              <select
                className="input w-auto text-xs"
                value={u.status}
                onChange={(e) => handleStatusChange(u.id, e.target.value as AccountStatus)}
              >
                {(Object.keys(STATUS_LABELS) as AccountStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            )}
            <button className="btn-ghost text-xs" onClick={() => setResettingPasswordFor(u)}>
              Reset password
            </button>
            {u.id !== currentUserId && (
              <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(u)}>
                Delete
              </button>
            )}
          </div>
        ))}
      </div>

      <ResetPasswordModal user={resettingPasswordFor} onClose={() => setResettingPasswordFor(null)} />

      <ConfirmDialog
        open={!!deleting}
        title="Delete user?"
        message={
          deleting
            ? `This permanently deletes ${deleting.email}'s account.${
                ownedProjectCount(deleting.id) > 0
                  ? ` They own ${ownedProjectCount(deleting.id)} construction${
                      ownedProjectCount(deleting.id) === 1 ? "" : "s"
                    }, which ${ownedProjectCount(deleting.id) === 1 ? "will" : "will all"} be permanently deleted too, along with everything in ${
                      ownedProjectCount(deleting.id) === 1 ? "it" : "them"
                    }. `
                  : " "
              }This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          const res = await deleteUser(deleting.id);
          setBusy(false);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete user.");
          } else {
            notify("success", `${deleting.email} deleted.`);
            setRows((r) => r.filter((u) => u.id !== deleting.id));
          }
          setDeleting(null);
        }}
      />
    </section>
  );
}

// Avoids visually-ambiguous characters (0/O, 1/l/I) since a Developer will
// be reading this back to someone or pasting it somewhere they can't
// immediately verify.
function generatePassword(length = 14): string {
  const charset = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => charset[b % charset.length]).join("");
}

function ResetPasswordModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const { notify } = useToast();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-arm for the next user this modal opens for, since it stays mounted
  // (Modal itself unmounts its content, but this component's state
  // wouldn't otherwise reset between two different "Reset password" clicks).
  useEffect(() => {
    if (user) {
      setPassword("");
      setShow(false);
      setSaved(false);
    }
  }, [user]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(password);
      notify("success", "Password copied.");
    } catch {
      notify("error", "Could not copy — copy it manually.");
    }
  }

  async function handleSave() {
    if (!user || password.length < 6) return;
    setSaving(true);
    const res = await resetUserPassword(user.id, password);
    setSaving(false);
    if (!res.ok) {
      notify("error", res.error ?? "Could not reset password.");
      return;
    }
    setSaved(true);
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={user ? `Reset password — ${user.email}` : "Reset password"}
      footer={
        saved ? (
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn-outline" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving || password.length < 6}>
              {saving ? "Saving…" : "Set password"}
            </button>
          </>
        )
      }
    >
      {saved ? (
        <div className="space-y-3">
          <p className="text-sm text-blueprint/70">
            Password reset. Share it with {user?.email} yourself — it won&apos;t be shown again once you close this.
          </p>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1 font-mono"
              readOnly
              value={password}
              onFocus={(e) => e.target.select()}
            />
            <button className="btn-ghost text-xs" onClick={handleCopy}>
              Copy
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-blueprint/60">
            Sets this account&apos;s password directly — they don&apos;t need to click a link or know their old
            one first. Make sure to send them the new password yourself afterward.
          </p>
          <div>
            <label className="label">New password</label>
            <div className="flex items-center gap-2">
              <input
                type={show ? "text" : "password"}
                className="input flex-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                minLength={6}
                autoFocus
              />
              <button type="button" className="btn-ghost text-xs" onClick={() => setShow((s) => !s)}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => {
              setPassword(generatePassword());
              setShow(true);
            }}
          >
            Generate a random password
          </button>
        </div>
      )}
    </Modal>
  );
}

function ProjectsSection({ projects }: { projects: AdminProject[] }) {
  const [selected, setSelected] = useState<AdminProject | null>(null);

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">Projects &amp; invites</h2>
      <p className="mb-3 text-xs text-blueprint/50">
        Pick a construction to invite someone onto it, or manage its existing members and pending invites.
      </p>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-1">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${
                selected?.id === p.id ? "border-amber bg-amber/10" : "border-blueprint/10 bg-white hover:border-blueprint/30"
              }`}
            >
              <div className="font-medium text-blueprint-dark">{p.name}</div>
              <div className="text-xs text-blueprint/40">Owner: {p.ownerEmail}</div>
            </button>
          ))}
          {projects.length === 0 && <p className="text-sm text-blueprint/50">No constructions yet.</p>}
        </div>
        <div>{selected ? <ProjectInvitePanel key={selected.id} project={selected} /> : <p className="text-sm text-blueprint/50">Select a construction on the left.</p>}</div>
      </div>
    </section>
  );
}

function ProjectInvitePanel({ project }: { project: AdminProject }) {
  const { notify } = useToast();
  const [invites, setInvites] = useState<ProjectInviteRow[]>([]);
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("contractor");
  const [sending, startSending] = useTransition();
  const [removing, setRemoving] = useState<{ kind: "invite" | "member"; id: string } | null>(null);

  async function refresh() {
    const res = await listProjectInvitesAndMembers(project.id);
    setInvites(res.invites);
    setMembers(res.members);
    setLoaded(true);
  }

  useEffect(() => {
    setLoaded(false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  function inviteUrl(token: string): string {
    if (typeof window === "undefined") return `/invite/${token}`;
    return `${window.location.origin}/invite/${token}`;
  }

  async function handleCopy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      notify("success", "Invite link copied.");
    } catch {
      notify("error", "Could not copy — copy it manually.");
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    startSending(async () => {
      const res = await sendProjectInvite(project.id, email, role);
      if (!res.ok) {
        notify("error", res.error ?? "Could not send invite.");
        return;
      }
      notify(
        "success",
        res.emailSent ? `Invite email sent to ${email}.` : (res.emailNote ?? `Invite created for ${email}. Copy the link below to send it.`)
      );
      setEmail("");
      await refresh();
    });
  }

  if (!loaded) {
    return <div className="rounded-lg border border-blueprint/10 bg-white p-4 text-sm text-blueprint/50">Loading…</div>;
  }

  return (
    <div className="space-y-5 rounded-lg border border-blueprint/10 bg-white p-4">
      <form onSubmit={handleSend} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="label">Email</label>
          <input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
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
      {role === "developer" && (
        <p className="-mt-3 text-xs text-amber-700">
          Developer is an admin role — accepting this invite grants full access to every construction and the
          Admin page, not just this one.
        </p>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blueprint/50">Members</h3>
        {members.length === 0 ? (
          <p className="text-sm text-blueprint/50">No invited members yet.</p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg border border-blueprint/10 p-2 text-sm">
                <span className="flex-1 truncate">{m.email ?? m.user_id}</span>
                <span className="badge-amber text-xs">{ROLE_LABELS[m.role]}</span>
                <button className="text-xs text-red-500 hover:underline" onClick={() => setRemoving({ kind: "member", id: m.id })}>
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
                    <button className="text-xs text-red-500 hover:underline" onClick={() => setRemoving({ kind: "invite", id: i.id })}>
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

      <ConfirmDialog
        open={!!removing}
        title={removing?.kind === "invite" ? "Revoke invite?" : "Remove member?"}
        message={
          removing?.kind === "invite"
            ? "This invite link will stop working."
            : "They will immediately lose access to this construction."
        }
        confirmLabel={removing?.kind === "invite" ? "Revoke" : "Remove"}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const res = removing.kind === "invite" ? await revokeInvite(removing.id, project.id) : await removeMember(removing.id, project.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not complete that action.");
          } else {
            notify("success", removing.kind === "invite" ? "Invite revoked." : "Member removed.");
            await refresh();
          }
          setRemoving(null);
        }}
      />
    </div>
  );
}
