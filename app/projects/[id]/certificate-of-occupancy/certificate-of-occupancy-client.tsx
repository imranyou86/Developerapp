"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { telHref } from "@/lib/phone";
import { renameProject } from "@/app/projects/actions";
import { saveCertificateOfOccupancy, type SaveCertificateOfOccupancyInput } from "@/app/projects/[id]/certificate-of-occupancy/actions";
import type { CertificateOfOccupancy } from "@/lib/types";

function statusBadgeClass(status: string | null): string {
  if (!status) return "badge bg-blueprint/10 text-blueprint/60";
  const s = status.toLowerCase();
  if (s.includes("issued") && !s.includes("not")) return "badge-sage";
  if (s.includes("pending") || s.includes("not yet") || s.includes("not issued")) return "badge-amber";
  return "badge bg-blueprint/10 text-blueprint/60";
}

const CONFIDENCE_LABEL: Record<string, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

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
  const { run, isRunning } = useBackgroundTasks();
  const [address, setAddress] = useState(initialAddress);
  const [addressInput, setAddressInput] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const [check, setCheck] = useState<CertificateOfOccupancy | null>(initialCheck);
  const taskKey = `certificate-of-occupancy:${projectId}`;
  const checking = isRunning(taskKey);

  async function runCheck(forAddress: string) {
    try {
      await run(taskKey, "Checking Certificate of Occupancy status…", async () => {
        const res = await fetchWithRetry("/api/claude/lookup-certificate-of-occupancy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: forAddress }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Lookup failed.");

        const input: SaveCertificateOfOccupancyInput = {
          status: json.status ?? null,
          co_number: json.co_number ?? null,
          issued_date: json.issued_date ?? null,
          open_clearances: json.open_clearances ?? [],
          permits: json.permits ?? [],
          inspector: json.inspector ?? null,
          source_url: json.source_url ?? null,
          confidence: json.confidence ?? null,
          notes: json.notes ?? null,
        };
        const saveRes = await saveCertificateOfOccupancy(projectId, input);
        if (!saveRes.ok || !saveRes.check) throw new Error(saveRes.error ?? "Could not save the result.");

        setCheck(saveRes.check);
        notify("success", "Certificate of Occupancy information updated.");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Lookup failed.");
    }
  }

  async function handleSaveAddressAndCheck() {
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
    runCheck(trimmed);
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h2 className="font-semibold text-blueprint-dark">Certificate of Occupancy</h2>
        <p className="mt-1 text-sm text-blueprint/60">
          Looks up this construction&apos;s Certificate of Occupancy status, any open or remaining clearances, issued
          permits, and inspector information (when available), based on the address above.
        </p>
        <p className="mt-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber-700">
          Covers properties within LADBS&apos;s jurisdiction (City of Los Angeles / LA County) only — addresses
          elsewhere won&apos;t return useful results. This is a best-effort web search against public records, not a
          live query against LADBS&apos;s own database, so always verify anything important directly with LADBS.
        </p>
      </div>

      {!address ? (
        <div className="card space-y-3 p-6">
          <p className="text-sm text-blueprint/70">
            No address on file for this construction yet. Enter one to run a Certificate of Occupancy check.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="input max-w-sm flex-1"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="123 Main St, Los Angeles, CA 90012"
            />
            <button
              className="btn-amber"
              onClick={handleSaveAddressAndCheck}
              disabled={savingAddress || checking || !addressInput.trim()}
            >
              {savingAddress ? "Saving…" : checking ? "Checking…" : "Save & check"}
            </button>
          </div>
        </div>
      ) : (
        <div className="card space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-blueprint/60">
              Address: <span className="font-medium text-blueprint-dark">{address}</span>
            </p>
            <button className="btn-amber" onClick={() => runCheck(address)} disabled={checking}>
              {checking ? "Checking…" : "Update information"}
            </button>
          </div>

          {!check ? (
            <p className="text-sm text-blueprint/50">Not checked yet — click &quot;Update information&quot; to run a check.</p>
          ) : (
            <div className="space-y-5 border-t border-blueprint/10 pt-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusBadgeClass(check.status)}>{check.status ?? "Unknown"}</span>
                  {check.confidence && (
                    <span className="text-xs text-blueprint/40">{CONFIDENCE_LABEL[check.confidence]}</span>
                  )}
                </div>
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
                {check.source_url && (
                  <a
                    href={check.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-amber-dark hover:underline"
                  >
                    View source ↗
                  </a>
                )}
                <p className="mt-2 text-xs text-blueprint/40">
                  Last checked {new Date(check.last_checked_at).toLocaleString()}
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-blueprint-dark">Open / remaining clearances</h3>
                {check.open_clearances.length === 0 ? (
                  <p className="text-sm text-blueprint/50">None found.</p>
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
                <h3 className="mb-2 text-sm font-semibold text-blueprint-dark">Issued permits</h3>
                {check.permits.length === 0 ? (
                  <p className="text-sm text-blueprint/50">None found.</p>
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
                <h3 className="mb-2 text-sm font-semibold text-blueprint-dark">Inspector information</h3>
                {!check.inspector || (!check.inspector.name && !check.inspector.phone && !check.inspector.email) ? (
                  <p className="text-sm text-blueprint/50">No inspector information found.</p>
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
      )}
    </div>
  );
}
