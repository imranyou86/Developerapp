"use client";

import { useMemo, useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import {
  createSubcontractor,
  deleteSubcontractor,
  setSubcontractorProjects,
  updateSubcontractor,
  type SubcontractorInput,
} from "@/app/subcontractors/actions";
import { telHref } from "@/lib/phone";
import type { Subcontractor } from "@/lib/types";

interface ProjectOption {
  id: string;
  name: string;
}

const EMPTY_INPUT: SubcontractorInput = {
  company_name: "",
  contact_name: "",
  trade: "",
  phone: "",
  email: "",
  address: "",
  license_number: "",
  license_state: "",
  license_status: "",
  reliability: null,
  cost_tier: null,
  notes: "",
};

function toInput(s: Subcontractor): SubcontractorInput {
  return {
    company_name: s.company_name,
    contact_name: s.contact_name ?? "",
    trade: s.trade ?? "",
    phone: s.phone ?? "",
    email: s.email ?? "",
    address: s.address ?? "",
    license_number: s.license_number ?? "",
    license_state: s.license_state ?? "",
    license_status: s.license_status ?? "",
    reliability: s.reliability,
    cost_tier: s.cost_tier,
    notes: s.notes ?? "",
  };
}

// CSLB = California's Contractors State License Board — this deep link
// format (mirrors what many contractors' own "verify my license" links use)
// pre-fills the license number on CSLB's real check-license page. There's no
// public API to pull a machine-readable result from directly (an AI web
// search can't drive that page's form, and government sites like this
// commonly block iframe embedding), so this opens the authoritative source
// in a new tab rather than attempting to parse a result automatically.
function cslbCheckUrl(licenseNumber: string): string {
  return `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx?LicNum=${encodeURIComponent(licenseNumber.trim())}`;
}

function licenseStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("active")) return "badge-sage";
  if (s.includes("expired") || s.includes("suspend") || s.includes("revoke") || s.includes("inactive")) {
    return "badge bg-red-100 text-red-700";
  }
  return "badge bg-blueprint/10 text-blueprint/60";
}

function Stars({ value }: { value: number | null }) {
  if (!value) return <span className="text-xs text-blueprint/40">Not rated</span>;
  return (
    <span className="text-sm text-amber-dark" title={`${value}/5 reliability`}>
      {"★".repeat(value)}
      <span className="text-blueprint/20">{"★".repeat(5 - value)}</span>
    </span>
  );
}

function CostTier({ value }: { value: number | null }) {
  if (!value) return <span className="text-xs text-blueprint/40">Not rated</span>;
  return (
    <span className="text-sm font-semibold text-sage-dark" title={`Cost tier ${value}/4`}>
      {"$".repeat(value)}
      <span className="text-blueprint/20">{"$".repeat(4 - value)}</span>
    </span>
  );
}

export function SubcontractorsClient({
  initialSubs,
  currentUserId,
  isDeveloper,
  allProjects,
  initialProjectsBySubId,
}: {
  initialSubs: Subcontractor[];
  currentUserId: string;
  isDeveloper: boolean;
  allProjects: ProjectOption[];
  initialProjectsBySubId: Record<string, string[]>;
}) {
  const { notify } = useToast();
  const [subs, setSubs] = useState<Subcontractor[]>(initialSubs);
  const [projectsBySubId, setProjectsBySubId] = useState<Record<string, string[]>>(initialProjectsBySubId);
  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subcontractor | null>(null);
  const [deleting, setDeleting] = useState<Subcontractor | null>(null);
  const [pending, startTransition] = useTransition();

  const projectNameById = useMemo(() => new Map(allProjects.map((p) => [p.id, p.name])), [allProjects]);

  const trades = useMemo(
    () => Array.from(new Set(subs.map((s) => s.trade).filter((t): t is string => !!t))).sort(),
    [subs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subs.filter((s) => {
      if (tradeFilter !== "all" && s.trade !== tradeFilter) return false;
      if (!q) return true;
      return [s.company_name, s.contact_name, s.trade, s.notes].some((f) => f?.toLowerCase().includes(q));
    });
  }, [subs, search, tradeFilter]);

  function canEdit(s: Subcontractor): boolean {
    return isDeveloper || s.created_by === currentUserId;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs flex-1"
          placeholder="Search company, contact, trade, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-auto" value={tradeFilter} onChange={(e) => setTradeFilter(e.target.value)}>
          <option value="all">All trades</option>
          {trades.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          className="btn-amber ml-auto"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          + Add subcontractor
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">
          {subs.length === 0
            ? "No subcontractors yet. Add the first one to start building the directory."
            : "No subcontractors match your search."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-blueprint-dark">{s.company_name}</h3>
                    {s.trade && <span className="badge-sage">{s.trade}</span>}
                  </div>
                  {s.contact_name && <p className="text-sm text-blueprint/60">{s.contact_name}</p>}
                </div>
                {canEdit(s) && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="btn-ghost text-xs"
                      onClick={() => {
                        setEditing(s);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(s)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm text-blueprint/70 sm:grid-cols-2">
                {s.phone && (
                  <div>
                    <span className="text-blueprint/40">Phone: </span>
                    <a href={telHref(s.phone)} className="text-blueprint hover:text-amber hover:underline">
                      {s.phone}
                    </a>
                  </div>
                )}
                {s.email && (
                  <div>
                    <span className="text-blueprint/40">Email: </span>
                    <a href={`mailto:${s.email}`} className="text-blueprint hover:text-amber hover:underline">
                      {s.email}
                    </a>
                  </div>
                )}
                {s.address && (
                  <div className="sm:col-span-2">
                    <span className="text-blueprint/40">Address: </span>
                    {s.address}
                  </div>
                )}
                {(s.license_number || s.license_state) && (
                  <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2">
                    <span className="text-blueprint/40">License: </span>
                    {s.license_number ?? "—"}
                    {s.license_state && ` (${s.license_state})`}
                    {s.license_status && (
                      <>
                        <span className={licenseStatusBadgeClass(s.license_status)}>{s.license_status}</span>
                        {s.license_checked_at && (
                          <span className="text-xs text-blueprint/40">
                            checked {new Date(s.license_checked_at).toLocaleDateString()}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-blueprint/10 pt-3">
                <div className="flex items-center gap-1.5 text-xs text-blueprint/50">
                  Reliability
                  <Stars value={s.reliability} />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-blueprint/50">
                  Cost
                  <CostTier value={s.cost_tier} />
                </div>
              </div>

              {s.notes && <p className="mt-2 text-xs text-blueprint/60">{s.notes}</p>}

              {(projectsBySubId[s.id]?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-blueprint/40">Working on:</span>
                  {(projectsBySubId[s.id] ?? [])
                    .map((pid) => projectNameById.get(pid))
                    .filter((name): name is string => !!name)
                    .map((name) => (
                      <span key={name} className="badge-amber text-xs">
                        {name}
                      </span>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <SubcontractorFormModal
          // Remounts (fresh internal form state) whenever the target
          // changes — including reopening for the same target after a
          // cancel, since the whole component unmounts when formOpen goes
          // false — rather than reusing one persistent instance whose
          // state would otherwise carry a cancelled edit's leftover text
          // into the next time the form opens.
          key={editing?.id ?? "new"}
          editing={editing}
          allProjects={allProjects}
          initialSelectedProjectIds={editing ? (projectsBySubId[editing.id] ?? []) : []}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={(saved, projectIds) => {
            setSubs((prev) => {
              const exists = prev.some((s) => s.id === saved.id);
              return exists ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved].sort((a, b) => a.company_name.localeCompare(b.company_name));
            });
            setProjectsBySubId((prev) => ({ ...prev, [saved.id]: projectIds }));
            notify("success", editing ? "Subcontractor updated." : "Subcontractor added.");
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete subcontractor?"
        message={`"${deleting?.company_name}" will be permanently removed from the directory. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          startTransition(async () => {
            const res = await deleteSubcontractor(deleting.id);
            if (!res.ok) {
              notify("error", res.error ?? "Could not delete.");
            } else {
              setSubs((prev) => prev.filter((s) => s.id !== deleting.id));
              notify("success", "Subcontractor deleted.");
            }
            setDeleting(null);
          });
        }}
      />
    </div>
  );
}

function SubcontractorFormModal({
  editing,
  allProjects,
  initialSelectedProjectIds,
  onClose,
  onSaved,
}: {
  editing: Subcontractor | null;
  allProjects: ProjectOption[];
  initialSelectedProjectIds: string[];
  onClose: () => void;
  onSaved: (saved: Subcontractor, projectIds: string[]) => void;
}) {
  const { notify } = useToast();
  // No effect needed to re-seed this on target change — the parent gives
  // this component a `key` derived from `editing?.id`, so switching targets
  // (or reopening after a cancel) always mounts a fresh instance instead of
  // reusing one whose state could carry over a cancelled edit's leftovers.
  const [input, setInput] = useState<SubcontractorInput>(editing ? toInput(editing) : EMPTY_INPUT);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(initialSelectedProjectIds);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof SubcontractorInput>(field: K, value: SubcontractorInput[K]) {
    setInput((prev) => ({ ...prev, [field]: value }));
  }

  function toggleProject(id: string) {
    setSelectedProjectIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function handleSave() {
    startTransition(async () => {
      const res = editing ? await updateSubcontractor(editing.id, input) : await createSubcontractor(input);
      if (!res.ok || !res.subcontractor) {
        notify("error", res.error ?? "Could not save.");
        return;
      }
      // The subcontractor row itself is already saved at this point — a
      // failure here only affects which projects it's tagged on, so it's
      // reported but doesn't block treating the save as successful.
      const linkRes = await setSubcontractorProjects(res.subcontractor.id, selectedProjectIds);
      if (!linkRes.ok) {
        notify("error", linkRes.error ?? "Saved, but could not update project associations.");
      }
      onSaved(res.subcontractor, linkRes.ok ? selectedProjectIds : (editing ? initialSelectedProjectIds : []));
    });
  }

  return (
    <Modal open onClose={onClose} title={editing ? "Edit subcontractor" : "Add subcontractor"}
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={pending || !input.company_name.trim()}>
            {pending ? "Saving…" : editing ? "Save changes" : "Add"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Company name</label>
            <input className="input" value={input.company_name} onChange={(e) => set("company_name", e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Contact name</label>
            <input className="input" value={input.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Trade</label>
          <input
            className="input"
            list="subcontractor-trade-suggestions"
            value={input.trade}
            onChange={(e) => set("trade", e.target.value)}
            placeholder="e.g. Electrical, Plumbing, Framing…"
          />
          <datalist id="subcontractor-trade-suggestions">
            {["Electrical", "Plumbing", "HVAC", "Framing", "Roofing", "Concrete", "Drywall", "Painting", "Flooring", "Landscaping", "General"].map(
              (t) => (
                <option key={t} value={t} />
              )
            )}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Phone</label>
            <input className="input" type="tel" value={input.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={input.email} onChange={(e) => set("email", e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Address</label>
          <input className="input" value={input.address} onChange={(e) => set("address", e.target.value)} />
        </div>

        <div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">License number</label>
              <input className="input" value={input.license_number} onChange={(e) => set("license_number", e.target.value)} />
            </div>
            <div>
              <label className="label">License state</label>
              <input
                className="input"
                maxLength={2}
                value={input.license_state}
                onChange={(e) => set("license_state", e.target.value.toUpperCase())}
                placeholder="CA"
              />
            </div>
          </div>
          <div className="mt-2 flex items-end gap-2">
            <div className="flex-1">
              <label className="label">License status</label>
              <input
                className="input"
                value={input.license_status}
                onChange={(e) => set("license_status", e.target.value)}
                placeholder="e.g. Active, Expired, Suspended…"
              />
            </div>
            {input.license_number.trim() ? (
              <a
                href={cslbCheckUrl(input.license_number)}
                target="_blank"
                rel="noreferrer"
                className="btn-outline whitespace-nowrap text-xs"
              >
                Check on CSLB ↗
              </a>
            ) : (
              <span className="btn-outline whitespace-nowrap text-xs cursor-not-allowed opacity-40" title="Enter a license number first">
                Check on CSLB ↗
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-blueprint/40">
            Opens California&apos;s CSLB license lookup in a new tab for this license number — copy whatever status
            it shows (Active, Expired, Suspended, etc.) into the field above. For an out-of-state license, check
            with that state&apos;s licensing board instead.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Reliability</label>
            <select
              className="input"
              value={input.reliability ?? ""}
              onChange={(e) => set("reliability", e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Not rated</option>
              <option value="1">★☆☆☆☆ — Poor</option>
              <option value="2">★★☆☆☆ — Fair</option>
              <option value="3">★★★☆☆ — Good</option>
              <option value="4">★★★★☆ — Very good</option>
              <option value="5">★★★★★ — Excellent</option>
            </select>
          </div>
          <div>
            <label className="label">Cost</label>
            <select
              className="input"
              value={input.cost_tier ?? ""}
              onChange={(e) => set("cost_tier", e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Not rated</option>
              <option value="1">$ — Budget</option>
              <option value="2">$$ — Moderate</option>
              <option value="3">$$$ — Pricey</option>
              <option value="4">$$$$ — Premium</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea
            className="input min-h-[70px]"
            value={input.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="e.g. Great for tile work, slow on punch-list items…"
          />
        </div>

        <div>
          <label className="label">Projects</label>
          {allProjects.length === 0 ? (
            <p className="text-xs text-blueprint/40">No constructions to assign yet.</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-blueprint/15 p-2">
              {allProjects.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-concrete">
                  <input
                    type="checkbox"
                    checked={selectedProjectIds.includes(p.id)}
                    onChange={() => toggleProject(p.id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-blueprint/40">Which constructions is this sub currently working on?</p>
        </div>
      </div>
    </Modal>
  );
}
