"use client";

import { useEffect, useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { updateTabPermission, updateUserRole } from "@/app/admin/actions";
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

// Inviting someone as "Developer" is a special case, handled on accept
// (see app/invite/[token]/page.tsx) — it promotes their account role to
// developer (full admin access everywhere), not just membership on this
// one project. A user's role can also be changed directly in the Users
// section above without going through an invite at all.
const INVITABLE_ROLES: UserRole[] = ["owner", "pm", "contractor", "developer"];

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AdminProject {
  id: string;
  name: string;
  address: string | null;
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
}: {
  matrix: MatrixRole[];
  users: AdminUser[];
  projects: AdminProject[];
  currentUserId: string;
}) {
  return (
    <div className="space-y-10">
      <TabPermissionMatrix initial={matrix} />
      <UsersSection users={users} currentUserId={currentUserId} />
      <ProjectsSection projects={projects} />
    </div>
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

function UsersSection({ users, currentUserId }: { users: AdminUser[]; currentUserId: string }) {
  const { notify } = useToast();
  const [rows, setRows] = useState(users);

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

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">Users</h2>
      <p className="mb-3 text-xs text-blueprint/50">Change anyone&apos;s account-level login type, including granting Developer access.</p>
      <div className="space-y-2">
        {rows.map((u) => (
          <div key={u.id} className="flex items-center gap-2 rounded-lg border border-blueprint/10 bg-white p-2 text-sm">
            <span className="flex-1 truncate">
              {u.email}
              {u.id === currentUserId && <span className="ml-2 text-xs text-blueprint/40">(you)</span>}
            </span>
            <select className="input w-auto text-xs" value={u.role} onChange={(e) => handleChange(u.id, e.target.value as UserRole)}>
              {ROLE_VALUES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </section>
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
      notify("success", `Invite created for ${email}.`);
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
