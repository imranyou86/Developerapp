"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import {
  updateTabPermission,
  updateUserRole,
  updateUserStatus,
  deleteUser,
  resetUserPassword,
  createAccount,
  updateUserTabPermission,
} from "@/app/admin/actions";
import { setPreviewRole } from "@/app/admin/preview-actions";
import {
  sendProjectInvite,
  revokeInvite,
  removeMember,
  listProjectInvitesAndMembers,
  addProjectMember,
  listMembershipsForUser,
  type ProjectInviteRow,
  type ProjectMemberRow,
  type UserMembershipRow,
} from "@/app/projects/[id]/invite-actions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ROLE_LABELS, ROLE_VALUES, ALL_TABS } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

const PREVIEWABLE_ROLES: UserRole[] = ["owner", "pm", "contractor", "warranty"];

// Inviting someone as "Developer" is a special case, handled on accept
// (see app/invite/[token]/page.tsx) — it promotes their account role to
// developer (full admin access everywhere), not just membership on this
// one project. A user's role can also be changed directly in the Users
// section above without going through an invite at all. "Warranty" is
// typically set this way (change an existing member's role) once their
// construction is complete, rather than through a fresh invite.
const INVITABLE_ROLES: UserRole[] = ["owner", "pm", "contractor", "developer", "warranty"];

export type AccountStatus = "pending" | "approved" | "rejected";

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  isTest: boolean;
  /** This account's user_tab_permissions overrides, keyed by tab slug — wins over the role default for that tab only. */
  tabOverrides: Record<string, boolean>;
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
      <CreateAccountSection setRows={setRows} projects={projects} />
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

// Avoids visually-ambiguous characters (0/O, 1/l/I) since a Developer will
// be reading this back to someone or pasting it somewhere they can't
// immediately verify.
function generatePassword(length = 14): string {
  const charset = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => charset[b % charset.length]).join("");
}

// Creates an account directly — skips the public /login sign-up form (and
// its pending-approval queue, meant for that unsolicited path) since a
// Developer choosing to create one here has already made the access
// decision. Two use cases in one form: a throwaway "Test account" to try
// out a role's permissions (own badge in the Users list below, easy to
// spot and clean up later), or a real account handed to a specific person.
// Per-tab permission overrides aren't set here — create the account first,
// then use that row's "Permissions" button, the same panel every existing
// user gets.
function CreateAccountSection({
  setRows,
  projects,
}: {
  setRows: React.Dispatch<React.SetStateAction<AdminUser[]>>;
  projects: AdminProject[];
}) {
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [role, setRole] = useState<UserRole>("owner");
  const [isTest, setIsTest] = useState(true);
  const [assignProjectId, setAssignProjectId] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify("success", "Copied.");
    } catch {
      notify("error", "Could not copy — copy it manually.");
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await createAccount({ email, password, role, isTest });
    if (!res.ok || !res.userId) {
      setCreating(false);
      notify("error", res.error ?? "Could not create account.");
      return;
    }
    setRows((r) => [
      ...r,
      { id: res.userId!, email: email.trim().toLowerCase(), role, status: "approved", isTest, tabOverrides: {} },
    ]);

    // Assigning to a construction is a second, independent write
    // (project_members, not profiles) — the account itself is already
    // created and usable at this point even if this second step fails, so
    // that failure gets its own toast rather than rolling back or blocking
    // on it.
    if (assignProjectId) {
      const memberRes = await addProjectMember(assignProjectId, res.userId, role);
      if (!memberRes.ok) {
        notify("error", `Account created, but could not assign it to that construction: ${memberRes.error ?? "unknown error"}`);
      }
    }
    setCreating(false);

    setCreated({ email: email.trim().toLowerCase(), password });
    notify("success", assignProjectId ? "Account created and assigned." : "Account created.");
    setEmail("");
    setPassword("");
    setShow(false);
    setAssignProjectId("");
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">Create account</h2>
      <p className="mb-3 text-xs text-blueprint/50">
        Creates an account directly, pre-approved — no sign-up form or email confirmation needed. Use a test account
        to see exactly what a role (or a specific narrower/wider set of tabs, via that row&apos;s &quot;Permissions&quot;
        button below) looks like from the inside, or create a real account to hand to someone yourself.
      </p>
      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="label">Email</label>
          <input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </div>
        <div className="min-w-[160px]">
          <label className="label">Password</label>
          <div className="flex items-center gap-1">
            <input
              type={show ? "text" : "password"}
              required
              minLength={6}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
            <button type="button" className="btn-ghost px-2 text-xs" onClick={() => setShow((s) => !s)}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLE_VALUES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-ghost px-2 py-2 text-xs"
          onClick={() => {
            setPassword(generatePassword());
            setShow(true);
          }}
        >
          Generate password
        </button>
        <label className="flex items-center gap-1.5 px-1 py-2 text-xs text-blueprint/70">
          <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />
          Test account
        </label>
        <div className="min-w-[180px]">
          <label className="label">Assign to construction (optional)</label>
          <select className="input" value={assignProjectId} onChange={(e) => setAssignProjectId(e.target.value)}>
            <option value="">Don&apos;t assign yet</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-amber" disabled={creating}>
          {creating ? "Creating…" : "Create account"}
        </button>
      </form>

      {created && (
        <div className="mt-3 space-y-2 rounded-lg border border-sage/30 bg-sage/5 p-3">
          <p className="text-sm text-blueprint-dark">
            <strong>{created.email}</strong> created. Share these credentials with them yourself — the password won&apos;t
            be shown again once you dismiss this.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input flex-1 font-mono text-xs" readOnly value={created.password} onFocus={(e) => e.target.select()} />
            <button className="btn-ghost text-xs" onClick={() => handleCopy(created.password)}>
              Copy password
            </button>
            <button className="btn-ghost text-xs" onClick={() => handleCopy(created.email)}>
              Copy email
            </button>
            <button className="btn-outline text-xs" onClick={() => setCreated(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
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
  // An id, not the row itself — re-derived from `rows` below on every
  // render so the modal always reflects the latest overrides instead of a
  // stale snapshot captured when it was opened.
  const [managingPermissionsForId, setManagingPermissionsForId] = useState<string | null>(null);
  const managingPermissionsFor = rows.find((u) => u.id === managingPermissionsForId) ?? null;
  const [managingProjectsForId, setManagingProjectsForId] = useState<string | null>(null);
  const managingProjectsFor = rows.find((u) => u.id === managingProjectsForId) ?? null;
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
        {rows.map((u, i) => (
          <div
            key={u.id}
            className="flex animate-fade-in-up items-center gap-2 rounded-lg border border-blueprint/10 bg-white p-2 text-sm"
            style={{ animationDelay: `${Math.min(i * 20, 240)}ms` }}
          >
            <span className="flex-1 truncate">
              {u.email}
              {u.id === currentUserId && <span className="ml-2 text-xs text-blueprint/40">(you)</span>}
              {u.isTest && <span className="badge-sage ml-2 text-xs">Test</span>}
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
            {u.role !== "developer" && (
              <button className="btn-ghost text-xs" onClick={() => setManagingPermissionsForId(u.id)}>
                Permissions{Object.keys(u.tabOverrides).length > 0 && <span className="badge-amber ml-1 px-1.5">{Object.keys(u.tabOverrides).length}</span>}
              </button>
            )}
            <button className="btn-ghost text-xs" onClick={() => setManagingProjectsForId(u.id)}>
              Projects
            </button>
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

      <UserPermissionsModal
        user={managingPermissionsFor}
        onClose={() => setManagingPermissionsForId(null)}
        onChange={(tab, allowed) => {
          setRows((r) =>
            r.map((u) => {
              if (u.id !== managingPermissionsForId) return u;
              const tabOverrides = { ...u.tabOverrides };
              if (allowed === null) delete tabOverrides[tab];
              else tabOverrides[tab] = allowed;
              return { ...u, tabOverrides };
            })
          );
        }}
      />

      <UserProjectsModal user={managingProjectsFor} projects={projects} onClose={() => setManagingProjectsForId(null)} />

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

type OverrideChoice = "default" | "allowed" | "blocked";

function choiceOf(tabOverrides: Record<string, boolean>, tab: string): OverrideChoice {
  if (!(tab in tabOverrides)) return "default";
  return tabOverrides[tab] ? "allowed" : "blocked";
}

// Per-account exception on top of the role-wide Tab permissions matrix
// above — "Default" here means "use whatever that role's row in the
// matrix says," not "always allowed." Auto-saves each change immediately,
// same as the role matrix's own checkboxes, rather than a separate Save
// step.
function UserPermissionsModal({
  user,
  onClose,
  onChange,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onChange: (tab: string, allowed: boolean | null) => void;
}) {
  const { notify } = useToast();
  const [savingTab, setSavingTab] = useState<string | null>(null);

  async function handleChange(tab: string, choice: OverrideChoice) {
    if (!user) return;
    const allowed = choice === "default" ? null : choice === "allowed";
    const previous = choiceOf(user.tabOverrides, tab);
    setSavingTab(tab);
    onChange(tab, allowed);
    const res = await updateUserTabPermission(user.id, tab, allowed);
    setSavingTab(null);
    if (!res.ok) {
      notify("error", res.error ?? "Could not save.");
      onChange(tab, previous === "default" ? null : previous === "allowed");
    }
  }

  return (
    <Modal open={!!user} onClose={onClose} title={user ? `Permissions — ${user.email}` : "Permissions"}>
      <div className="space-y-3">
        <p className="text-sm text-blueprint/60">
          Overrides this account&apos;s tab visibility beyond its role (currently{" "}
          <strong>{user ? ROLE_LABELS[user.role] : ""}</strong>). &quot;Default&quot; means it follows whatever the
          Tab permissions matrix above says for that role; &quot;Allowed&quot;/&quot;Blocked&quot; pins it for this
          account only, regardless of future changes to that matrix.
        </p>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-blueprint/10">
          <table className="w-full text-sm">
            <tbody>
              {user &&
                ALL_TABS.map((t) => (
                  <tr key={t.slug} className="border-b border-blueprint/5 last:border-0">
                    <td className="px-3 py-2 text-blueprint-dark">{t.label}</td>
                    <td className="px-3 py-2 text-right">
                      <select
                        className="input w-auto py-1 text-xs"
                        value={choiceOf(user.tabOverrides, t.slug)}
                        disabled={savingTab === t.slug}
                        onChange={(e) => handleChange(t.slug, e.target.value as OverrideChoice)}
                      >
                        <option value="default">Default</option>
                        <option value="allowed">Allowed</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

// Direct assignment to a construction — no invite/token/email/acceptance
// step, since this account already exists with known credentials and a
// Developer choosing to assign it here has already made the access
// decision (addProjectMember relies on the same is_developer() bypass
// project_members_insert's RLS policy already grants). Complements the
// "Projects & invites" section below, which is for inviting someone who
// may not have an account yet; this is the reverse direction — starting
// from an existing account and picking which construction(s) it can see.
function UserProjectsModal({
  user,
  projects,
  onClose,
}: {
  user: AdminUser | null;
  projects: AdminProject[];
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [memberships, setMemberships] = useState<UserMembershipRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [assignProjectId, setAssignProjectId] = useState("");
  const [assignRole, setAssignRole] = useState<UserRole>("warranty");
  const [assigning, setAssigning] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoaded(false);
    listMembershipsForUser(user.id).then((rows) => {
      setMemberships(rows);
      setLoaded(true);
    });
  }, [user]);

  const assignableProjects = projects.filter((p) => !memberships.some((m) => m.project_id === p.id));

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !assignProjectId) return;
    setAssigning(true);
    const res = await addProjectMember(assignProjectId, user.id, assignRole);
    if (!res.ok) {
      setAssigning(false);
      notify("error", res.error ?? "Could not assign to that construction.");
      return;
    }
    // Refetches rather than appending an optimistic row locally — the
    // action doesn't return the new project_members row's real id, and a
    // made-up one wouldn't match anything for handleRemove's delete below.
    const rows = await listMembershipsForUser(user.id);
    setMemberships(rows);
    setAssigning(false);
    setAssignProjectId("");
    notify("success", "Assigned.");
  }

  async function handleRemove(membershipId: string, projectId: string) {
    if (!user) return;
    setRemovingId(membershipId);
    const res = await removeMember(membershipId, projectId, user.email);
    setRemovingId(null);
    if (!res.ok) {
      notify("error", res.error ?? "Could not remove.");
      return;
    }
    setMemberships((m) => m.filter((row) => row.id !== membershipId));
    notify("success", "Removed.");
  }

  return (
    <Modal open={!!user} onClose={onClose} title={user ? `Constructions — ${user.email}` : "Constructions"}>
      <div className="space-y-3">
        <p className="text-sm text-blueprint/60">
          Which constructions this account can access, beyond any it owns outright. Assigning here grants access
          immediately — no invite email or acceptance step, since this account already exists.
        </p>
        {!loaded ? (
          <p className="text-sm text-blueprint/50">Loading…</p>
        ) : memberships.length === 0 ? (
          <p className="text-sm text-blueprint/50">Not assigned to any construction yet.</p>
        ) : (
          <div className="space-y-2">
            {memberships.map((m) => {
              const project = projects.find((p) => p.id === m.project_id);
              return (
                <div key={m.id} className="flex items-center gap-2 rounded-lg border border-blueprint/10 p-2 text-sm">
                  <span className="flex-1 truncate">{project?.name ?? m.project_id}</span>
                  <span className="badge-amber text-xs">{ROLE_LABELS[m.role]}</span>
                  <button
                    className="text-xs text-red-500 hover:underline"
                    disabled={removingId === m.id}
                    onClick={() => handleRemove(m.id, m.project_id)}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {assignableProjects.length > 0 && (
          <form onSubmit={handleAssign} className="flex flex-wrap items-end gap-2 border-t border-blueprint/10 pt-3">
            <div className="min-w-[160px] flex-1">
              <label className="label">Assign to</label>
              <select className="input" value={assignProjectId} onChange={(e) => setAssignProjectId(e.target.value)}>
                <option value="">Choose a construction…</option>
                {assignableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={assignRole} onChange={(e) => setAssignRole(e.target.value as UserRole)}>
                {ROLE_VALUES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-amber" disabled={assigning || !assignProjectId}>
              {assigning ? "Assigning…" : "Assign"}
            </button>
          </form>
        )}
      </div>
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
      {role === "warranty" && (
        <p className="-mt-3 text-xs text-amber-700">
          Warranty is account-wide — once accepted, this person will only ever see the Warranty Request tab, on
          every construction their account has access to.
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
