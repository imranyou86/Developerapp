"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { telHref } from "@/lib/phone";
import { splitAddress } from "@/lib/address";
import { renameProject } from "@/app/projects/actions";
import { saveCertificateOfOccupancy, type SaveCertificateOfOccupancyInput } from "@/app/projects/[id]/certificate-of-occupancy/actions";
import type { CertificateOfOccupancy, COClearance, COInspector, COPermit } from "@/lib/types";

const LADBS_PLR_URL = "https://www.ladbsservices2.lacity.org/OnlineServices/?service=plr";

const EMPTY_INSPECTOR: COInspector = { name: "", phone: "", email: "", department: "" };

function statusBadgeClass(status: string | null): string {
  if (!status) return "badge bg-blueprint/10 text-blueprint/60";
  const s = status.toLowerCase();
  if (s.includes("issued") && !s.includes("not")) return "badge-sage";
  if (s.includes("pending") || s.includes("not yet") || s.includes("not issued")) return "badge-amber";
  return "badge bg-blueprint/10 text-blueprint/60";
}

export function CertificateOfOccupancyClient({
  projectId,
  projectName,
  initialAddress,
  initialCheck,
}: {
  projectId: string;
  projectName: string;
  initialAddress: string | null;
  initialCheck: CertificateOfOccupancy | null;
}) {
  const { notify } = useToast();
  const [address, setAddress] = useState(initialAddress);
  const [addressInput, setAddressInput] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const [check, setCheck] = useState<CertificateOfOccupancy | null>(initialCheck);
  const [formOpen, setFormOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<"number" | "street" | null>(null);

  async function handleSaveAddress() {
    const trimmed = addressInput.trim();
    if (!trimmed) return;
    setSavingAddress(true);
    const res = await renameProject(projectId, projectName, trimmed);
    setSavingAddress(false);
    if (!res.ok) {
      notify("error", res.error ?? "Could not save address.");
      return;
    }
    setAddress(trimmed);
    notify("success", "Address saved.");
  }

  async function handleCopyPart(field: "number" | "street", value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 2000);
    } catch {
      notify("error", "Could not copy — copy it manually.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h2 className="font-semibold text-blueprint-dark">Certificate of Occupancy</h2>
        <p className="mt-1 text-sm text-blueprint/60">
          Search this construction&apos;s address in LADBS&apos;s own Property Activity Report tool below, then
          record the Certificate of Occupancy status, open clearances, issued permits, and inspector info you find
          there — kept here in one clean place for the team.
        </p>
        <p className="mt-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber-700">
          Covers properties within LADBS&apos;s jurisdiction (City of Los Angeles / LA County) only — addresses
          elsewhere won&apos;t have results. This embeds LADBS&apos;s own tool directly — nothing here is fetched or
          scraped automatically, so the findings below are only as current as whoever last recorded them.
        </p>
      </div>

      {!address ? (
        <div className="card space-y-3 p-6">
          <p className="text-sm text-blueprint/70">
            No address on file for this construction yet. Enter one to search LADBS.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="input max-w-sm flex-1"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="123 Main St, Los Angeles, CA 90012"
            />
            <button className="btn-amber" onClick={handleSaveAddress} disabled={savingAddress || !addressInput.trim()}>
              {savingAddress ? "Saving…" : "Save address"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="card space-y-3 p-6">
            <p className="text-sm text-blueprint/60">
              Address: <span className="font-medium text-blueprint-dark">{address}</span>
            </p>
            <div className="flex flex-wrap items-end gap-2">
              {(() => {
                const { number, street } = splitAddress(address);
                return (
                  <>
                    <div>
                      <span className="label">House number</span>
                      <div className="flex items-center gap-1.5">
                        <code className="rounded bg-concrete px-2 py-1 text-sm text-blueprint-dark">{number || "—"}</code>
                        <button
                          className="btn-outline px-2 py-1 text-xs"
                          onClick={() => handleCopyPart("number", number)}
                          disabled={!number}
                        >
                          {copiedField === "number" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <div>
                      <span className="label">Street name</span>
                      <div className="flex items-center gap-1.5">
                        <code className="rounded bg-concrete px-2 py-1 text-sm text-blueprint-dark">{street || "—"}</code>
                        <button
                          className="btn-outline px-2 py-1 text-xs"
                          onClick={() => handleCopyPart("street", street)}
                          disabled={!street}
                        >
                          {copiedField === "street" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
            <a href={LADBS_PLR_URL} target="_blank" rel="noopener noreferrer" className="btn-amber w-full sm:w-auto">
              Search LADBS ↗
            </a>
            <p className="text-xs text-blueprint/40">
              Opens LADBS&apos;s Property Activity Report tool in a new tab — LADBS blocks other sites from embedding
              it directly. Their search has separate House Number and Street Name fields, so copy each piece above
              into the matching field there, then come back and record what you find below.
            </p>
          </div>

          <div className="card space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-blueprint-dark">Recorded findings</h3>
              <button className="btn-amber" onClick={() => setFormOpen(true)}>
                {check ? "Update findings" : "Record findings"}
              </button>
            </div>

            {!check ? (
              <p className="text-sm text-blueprint/50">
                Nothing recorded yet — search the address above, then click &quot;Record findings&quot; to save what
                you find.
              </p>
            ) : (
              <div className="space-y-5 border-t border-blueprint/10 pt-4">
                <div>
                  <span className={statusBadgeClass(check.status)}>{check.status ?? "Unknown"}</span>
                  <div className="mt-1.5 space-y-0.5 text-sm text-blueprint/70">
                    {check.co_number && (
                      <p>
                        <span className="text-blueprint/40">CO number: </span>
                        {check.co_number}
                      </p>
                    )}
                    {check.issued_date && (
                      <p>
                        <span className="text-blueprint/40">Issued: </span>
                        {check.issued_date}
                      </p>
                    )}
                  </div>
                  {check.notes && <p className="mt-2 text-sm text-blueprint/70">{check.notes}</p>}
                  <p className="mt-2 text-xs text-blueprint/40">
                    Last updated {new Date(check.last_checked_at).toLocaleString()}
                  </p>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-blueprint-dark">Open / remaining clearances</h4>
                  {check.open_clearances.length === 0 ? (
                    <p className="text-sm text-blueprint/50">None recorded.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {check.open_clearances.map((c, i) => (
                        <div key={i} className="rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-sm">
                          {c.code && <span className="mr-1.5 font-semibold text-amber-700">{c.code}</span>}
                          {c.description}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-blueprint-dark">Issued permits</h4>
                  {check.permits.length === 0 ? (
                    <p className="text-sm text-blueprint/50">None recorded.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {check.permits.map((p, i) => (
                        <div key={i} className="rounded-lg border border-blueprint/10 px-3 py-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            {p.permit_number && <span className="font-medium text-blueprint-dark">{p.permit_number}</span>}
                            {p.type && <span className="badge-sage">{p.type}</span>}
                            {p.status && <span className="text-xs text-blueprint/50">{p.status}</span>}
                            {p.issued_date && <span className="text-xs text-blueprint/40">{p.issued_date}</span>}
                          </div>
                          {p.description && <p className="mt-0.5 text-xs text-blueprint/60">{p.description}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-blueprint-dark">Inspector information</h4>
                  {!check.inspector || (!check.inspector.name && !check.inspector.phone && !check.inspector.email) ? (
                    <p className="text-sm text-blueprint/50">None recorded.</p>
                  ) : (
                    <div className="rounded-lg border border-blueprint/10 px-3 py-2 text-sm text-blueprint/70">
                      {check.inspector.name && <p className="font-medium text-blueprint-dark">{check.inspector.name}</p>}
                      {check.inspector.department && <p className="text-xs text-blueprint/50">{check.inspector.department}</p>}
                      {check.inspector.phone && (
                        <p>
                          <a href={telHref(check.inspector.phone)} className="text-blueprint hover:text-amber hover:underline">
                            {check.inspector.phone}
                          </a>
                        </p>
                      )}
                      {check.inspector.email && (
                        <p>
                          <a href={`mailto:${check.inspector.email}`} className="text-blueprint hover:text-amber hover:underline">
                            {check.inspector.email}
                          </a>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {formOpen && (
        <FindingsFormModal
          projectId={projectId}
          initial={check}
          onClose={() => setFormOpen(false)}
          onSaved={(saved) => {
            setCheck(saved);
            setFormOpen(false);
            notify("success", "Findings saved.");
          }}
        />
      )}
    </div>
  );
}

function FindingsFormModal({
  projectId,
  initial,
  onClose,
  onSaved,
}: {
  projectId: string;
  initial: CertificateOfOccupancy | null;
  onClose: () => void;
  onSaved: (saved: CertificateOfOccupancy) => void;
}) {
  const { notify } = useToast();
  const [status, setStatus] = useState(initial?.status ?? "");
  const [coNumber, setCoNumber] = useState(initial?.co_number ?? "");
  const [issuedDate, setIssuedDate] = useState(initial?.issued_date ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [clearances, setClearances] = useState<COClearance[]>(initial?.open_clearances ?? []);
  const [permits, setPermits] = useState<COPermit[]>(initial?.permits ?? []);
  const [inspector, setInspector] = useState<COInspector>(initial?.inspector ?? EMPTY_INSPECTOR);
  const [pending, startTransition] = useTransition();

  function updateClearance(i: number, field: keyof COClearance, value: string) {
    setClearances((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)));
  }
  function updatePermit(i: number, field: keyof COPermit, value: string) {
    setPermits((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  }

  function handleSave() {
    startTransition(async () => {
      const inspectorHasData = inspector.name || inspector.phone || inspector.email || inspector.department;
      const input: SaveCertificateOfOccupancyInput = {
        status: status.trim() || null,
        co_number: coNumber.trim() || null,
        issued_date: issuedDate.trim() || null,
        open_clearances: clearances
          .map((c) => ({ code: c.code?.trim() || null, description: c.description.trim() }))
          .filter((c) => c.description),
        permits: permits
          .map((p) => ({
            permit_number: p.permit_number?.trim() || null,
            type: p.type?.trim() || null,
            status: p.status?.trim() || null,
            issued_date: p.issued_date?.trim() || null,
            description: p.description?.trim() || null,
          }))
          .filter((p) => p.permit_number || p.type || p.description),
        inspector: inspectorHasData
          ? {
              name: inspector.name?.trim() || null,
              phone: inspector.phone?.trim() || null,
              email: inspector.email?.trim() || null,
              department: inspector.department?.trim() || null,
            }
          : null,
        source_url: null,
        confidence: null,
        notes: notes.trim() || null,
      };
      const res = await saveCertificateOfOccupancy(projectId, input);
      if (!res.ok || !res.check) {
        notify("error", res.error ?? "Could not save.");
        return;
      }
      onSaved(res.check);
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record Certificate of Occupancy findings"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={pending}>
            {pending ? "Saving…" : "Save findings"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Status</label>
            <input
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="e.g. Certificate of Occupancy issued"
              autoFocus
            />
          </div>
          <div>
            <label className="label">CO number</label>
            <input className="input" value={coNumber} onChange={(e) => setCoNumber(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Issued date</label>
          <input className="input" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} placeholder="e.g. 03/14/2019" />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Open / remaining clearances</label>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setClearances((prev) => [...prev, { code: "", description: "" }])}
            >
              + Add clearance
            </button>
          </div>
          <div className="space-y-2">
            {clearances.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input w-24"
                  value={c.code ?? ""}
                  onChange={(e) => updateClearance(i, "code", e.target.value)}
                  placeholder="Code"
                />
                <input
                  className="input flex-1"
                  value={c.description}
                  onChange={(e) => updateClearance(i, "description", e.target.value)}
                  placeholder="Description"
                />
                <button
                  type="button"
                  className="text-blueprint/40 hover:text-red-500"
                  onClick={() => setClearances((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label="Remove clearance"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Issued permits</label>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setPermits((prev) => [...prev, { permit_number: "", type: "", status: "", issued_date: "", description: "" }])}
            >
              + Add permit
            </button>
          </div>
          <div className="space-y-2">
            {permits.map((p, i) => (
              <div key={i} className="space-y-1 rounded-lg border border-blueprint/10 p-2">
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    value={p.permit_number ?? ""}
                    onChange={(e) => updatePermit(i, "permit_number", e.target.value)}
                    placeholder="Permit #"
                  />
                  <input
                    className="input flex-1"
                    value={p.type ?? ""}
                    onChange={(e) => updatePermit(i, "type", e.target.value)}
                    placeholder="Type"
                  />
                  <button
                    type="button"
                    className="text-blueprint/40 hover:text-red-500"
                    onClick={() => setPermits((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove permit"
                  >
                    ×
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    value={p.status ?? ""}
                    onChange={(e) => updatePermit(i, "status", e.target.value)}
                    placeholder="Status (e.g. Finaled)"
                  />
                  <input
                    className="input flex-1"
                    value={p.issued_date ?? ""}
                    onChange={(e) => updatePermit(i, "issued_date", e.target.value)}
                    placeholder="Issued date"
                  />
                </div>
                <input
                  className="input"
                  value={p.description ?? ""}
                  onChange={(e) => updatePermit(i, "description", e.target.value)}
                  placeholder="Description"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Inspector information</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              value={inspector.name ?? ""}
              onChange={(e) => setInspector((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Name"
            />
            <input
              className="input"
              value={inspector.department ?? ""}
              onChange={(e) => setInspector((prev) => ({ ...prev, department: e.target.value }))}
              placeholder="Department"
            />
            <input
              className="input"
              type="tel"
              value={inspector.phone ?? ""}
              onChange={(e) => setInspector((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="Phone"
            />
            <input
              className="input"
              type="email"
              value={inspector.email ?? ""}
              onChange={(e) => setInspector((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="Email"
            />
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
