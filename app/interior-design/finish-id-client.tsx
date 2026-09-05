"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { addFinish } from "@/app/projects/[id]/rooms/actions";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { usePersistedSelection } from "@/lib/usePersistedSelection";
import { deleteFinishScan, saveFinishScan } from "@/app/interior-design/finish-id-actions";
import type { FinishCategory, IdentifiedFinish } from "@/lib/types";

interface ProjectOption {
  id: string;
  name: string;
}

interface RoomOption {
  id: string;
  name: string;
}

interface FinishScanRow {
  id: string;
  storage_url: string;
  label: string | null;
  results: IdentifiedFinish[];
  created_at: string;
}

const CONFIDENCE_STYLE: Record<IdentifiedFinish["confidence"], string> = {
  high: "badge-sage",
  medium: "badge-amber",
  low: "badge bg-blueprint/10 text-blueprint/60",
};

interface ProductMatch {
  brand: string;
  model: string | null;
  description: string;
  price: number | null;
  url: string | null;
  retailer: string | null;
  match_confidence: "exact" | "close" | "similar";
}

const MATCH_CONFIDENCE_STYLE: Record<ProductMatch["match_confidence"], string> = {
  exact: "badge-sage",
  close: "badge-amber",
  similar: "badge bg-blueprint/10 text-blueprint/60",
};

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function FinishIdClient({
  projects,
  roomsByProject,
  initialScans,
}: {
  projects: ProjectOption[];
  roomsByProject: Record<string, RoomOption[]>;
  initialScans: FinishScanRow[];
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const uploadTaskKey = "finish-upload";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scans, setScans] = useState<FinishScanRow[]>(initialScans);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [expandedScanId, setExpandedScanId] = useState<string | null>(initialScans[0]?.id ?? null);
  const [deleting, setDeleting] = useState<FinishScanRow | null>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadStatus("Uploading photo…");
    try {
      await run(uploadTaskKey, `Identifying finishes in "${file.name}"…`, async () => {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in.");

        // No project segment — a scan isn't tied to a construction up
        // front, unlike every other feature's storage path.
        const path = `${user.id}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("finish-scans").upload(path, file, {
          contentType: file.type,
        });
        if (uploadError) throw new Error(uploadError.message);

        const { data: pub } = supabase.storage.from("finish-scans").getPublicUrl(path);

        setUploadStatus("Identifying finishes…");
        const res = await fetchWithRetry("/api/claude/identify-finishes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: pub.publicUrl }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Finish identification failed.");

        const results: IdentifiedFinish[] = (json.items ?? []).map((item: IdentifiedFinish) => ({
          name: item.name,
          category: FINISH_CATEGORY_SET.has(item.category) ? item.category : "Other",
          description: item.description,
          color: item.color,
          confidence: item.confidence,
        }));

        const saveRes = await saveFinishScan(pub.publicUrl, file.name, results);
        if (!saveRes.ok || !saveRes.id) throw new Error(saveRes.error ?? "Could not save scan.");

        const newScan: FinishScanRow = {
          id: saveRes.id,
          storage_url: pub.publicUrl,
          label: file.name,
          results,
          created_at: new Date().toISOString(),
        };
        setScans((prev) => [newScan, ...prev]);
        setExpandedScanId(newScan.id);

        if (results.length === 0) {
          notify("success", "Scanned — no identifiable finishes found in this photo.");
        } else {
          notify("success", `Identified ${results.length} finish(es).`);
        }
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not process photo.");
    } finally {
      setUploading(false);
      setUploadStatus("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-blueprint-dark">Identify finishes from a photo</h2>
            <p className="text-sm text-blueprint/60">
              Upload any photo or screenshot — a listing photo, a Pinterest screenshot, a snapshot from a showroom —
              and Claude will identify the stone, tile, faucets, paint, and other finishes it can see. Once
              identified, send the ones you like to a specific construction&apos;s room.
            </p>
          </div>
          <button className="btn-amber" onClick={() => fileInputRef.current?.click()} disabled={uploading || isRunning(uploadTaskKey)}>
            {uploading || isRunning(uploadTaskKey) ? uploadStatus || "Working…" : "Upload photo"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />
        </div>
      </div>

      {scans.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">No scans yet.</div>
      ) : (
        <div className="space-y-4">
          {scans.map((scan) => (
            <ScanCard
              key={scan.id}
              scan={scan}
              projects={projects}
              roomsByProject={roomsByProject}
              expanded={expandedScanId === scan.id}
              onToggle={() => setExpandedScanId((id) => (id === scan.id ? null : scan.id))}
              onDelete={() => setDeleting(scan)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete scan?"
        message="This photo and its identified finishes list will be permanently removed. Anything already sent to a construction's room stays there."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteFinishScan(deleting.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete scan.");
          } else {
            setScans((prev) => prev.filter((s) => s.id !== deleting.id));
            notify("success", "Scan deleted.");
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

const FINISH_CATEGORY_SET = new Set<string>([
  "Tile",
  "Fixture",
  "Flooring",
  "Countertop",
  "Cabinetry",
  "Hardware",
  "Lighting",
  "Paint/Finish",
  "Appliance",
  "Other",
]);

function ScanCard({
  scan,
  projects,
  roomsByProject,
  expanded,
  onToggle,
  onDelete,
}: {
  scan: FinishScanRow;
  projects: ProjectOption[];
  roomsByProject: Record<string, RoomOption[]>;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { notify } = useToast();
  // "v2" — bumped because pre-fix builds persisted an all-checked default
  // under this same key; without the version bump, a stale sessionStorage
  // entry from that older behavior would load back in and look like the
  // "default unchecked" fix never took effect.
  const [selected, setSelected] = usePersistedSelection(`finish-scan-selected-v2:${scan.id}`, () => new Set());
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const rooms = roomsByProject[projectId] ?? [];
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [matchByItem, setMatchByItem] = useState<Record<number, ProductMatch | null>>({});

  function handleProjectChange(id: string) {
    setProjectId(id);
    setRoomId(roomsByProject[id]?.[0]?.id ?? "");
  }

  function selectAll(check: boolean) {
    setSelected(check ? new Set(scan.results.map((_, i) => String(i))) : new Set());
  }

  async function handleAddSelected() {
    if (!projectId || !roomId || selected.size === 0) return;
    setAdding(true);
    try {
      const indices = Array.from(selected, Number);
      for (const i of indices) {
        const item = scan.results[i];
        const match = matchByItem[i];
        const brand = match
          ? `${match.brand}${match.model ? ` ${match.model}` : ""}`
          : item.color
            ? `${item.color} — ${item.description}`
            : item.description;
        const res = await addFinish(projectId, roomId, {
          name: item.name,
          category: item.category as FinishCategory,
          brand,
          price: match?.price ?? null,
        });
        if (!res.ok) throw new Error(res.error ?? `Could not add "${item.name}".`);
      }
      setAdded((prev) => new Set([...prev, ...indices]));
      notify("success", `Sent ${indices.length} item(s) to the room's finishes.`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not send items.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="card">
      <button className="flex w-full items-center gap-4 p-4 text-left" onClick={onToggle}>
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-concrete">
          <Image src={scan.storage_url} alt={scan.label ?? "Scan"} fill className="object-cover" unoptimized />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-blueprint-dark">{scan.label ?? "Untitled scan"}</p>
          <p className="text-xs text-blueprint/50">
            {new Date(scan.created_at).toLocaleString()} · {scan.results.length} finish(es) identified
          </p>
        </div>
        <span className="text-lg text-blueprint/40">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-blueprint/10 p-4">
          {scan.results.length === 0 ? (
            <p className="text-sm text-blueprint/50">No identifiable finishes found in this photo.</p>
          ) : (
            <>
              <div className="flex items-center gap-3 text-xs text-blueprint/60">
                <button className="font-medium text-amber-dark hover:underline" onClick={() => selectAll(true)}>
                  Check all
                </button>
                <span>·</span>
                <button className="font-medium text-amber-dark hover:underline" onClick={() => selectAll(false)}>
                  Uncheck all
                </button>
              </div>
              <div className="space-y-2">
                {scan.results.map((item, i) => (
                  <IdentifiedItemRow
                    key={i}
                    taskKey={`finish-search:${scan.id}:${i}`}
                    item={item}
                    imageUrl={scan.storage_url}
                    checked={selected.has(String(i))}
                    disabled={added.has(i)}
                    added={added.has(i)}
                    onCheckedChange={(checked) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(String(i));
                        else next.delete(String(i));
                        return next;
                      })
                    }
                    selectedMatch={matchByItem[i] ?? null}
                    onMatchSelected={(match) => {
                      setMatchByItem((prev) => ({ ...prev, [i]: match }));
                      // Picking a specific product match is a clear signal the item is wanted —
                      // check it automatically rather than making the user check it separately.
                      if (match) setSelected((prev) => new Set(prev).add(String(i)));
                    }}
                  />
                ))}
              </div>

              {projects.length > 0 ? (
                <div className="space-y-2 border-t border-blueprint/10 pt-3">
                  <p className="text-xs font-medium text-blueprint-dark">Send selected to a construction</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="input flex-1" value={projectId} onChange={(e) => handleProjectChange(e.target.value)}>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {rooms.length > 0 ? (
                      <select className="input flex-1" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                        {rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="flex-1 text-xs text-amber-dark">No rooms in this construction yet.</p>
                    )}
                    <button className="btn-primary" onClick={handleAddSelected} disabled={adding || selected.size === 0 || rooms.length === 0}>
                      {adding ? "Sending…" : `Send ${selected.size} to room`}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="border-t border-blueprint/10 pt-3 text-xs text-amber-dark">
                  Add a construction first so identified finishes have somewhere to go.
                </p>
              )}
            </>
          )}

          <button className="text-xs text-red-500 hover:underline" onClick={onDelete}>
            Delete scan
          </button>
        </div>
      )}
    </div>
  );
}

function IdentifiedItemRow({
  taskKey,
  item,
  imageUrl,
  checked,
  disabled,
  added,
  onCheckedChange,
  selectedMatch,
  onMatchSelected,
}: {
  taskKey: string;
  item: IdentifiedFinish;
  imageUrl: string;
  checked: boolean;
  disabled: boolean;
  added: boolean;
  onCheckedChange: (checked: boolean) => void;
  selectedMatch: ProductMatch | null;
  onMatchSelected: (match: ProductMatch | null) => void;
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const [searching, setSearching] = useState(false);
  // Loaded lazily (not from sessionStorage on every keystroke) so a search
  // still shown as running via isRunning() after a remount can, once it
  // finishes, be picked up here instead of the result being silently lost.
  const [matches, setMatches] = useState<ProductMatch[] | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(`finish-search-result:${taskKey}`);
      return raw ? (JSON.parse(raw) as ProductMatch[]) : null;
    } catch {
      return null;
    }
  });

  async function handleSearch() {
    setSearching(true);
    // On a repeat search, tell Claude what's already been shown so it looks
    // for different products instead of re-returning the same ones — and
    // append rather than replace, so a match the user already liked (picked
    // via the radio below) stays in the list and selectable instead of
    // disappearing when new options come in.
    const previous = matches ?? [];
    try {
      const found = await run(taskKey, `Searching the web for "${item.name}"…`, async () => {
        const res = await fetchWithRetry("/api/claude/find-product", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: item.name,
            category: item.category,
            description: item.description,
            color: item.color,
            imageUrl,
            excludeMatches: previous.map((m) => ({ brand: m.brand, model: m.model, retailer: m.retailer })),
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Product search failed.");
        return (json.matches ?? []) as ProductMatch[];
      });

      const seen = new Set(previous.map((m) => `${m.brand}|${m.model}|${m.url}`));
      const newOnes = found.filter((m) => !seen.has(`${m.brand}|${m.model}|${m.url}`));
      const combined = [...previous, ...newOnes];
      setMatches(combined);
      try {
        sessionStorage.setItem(`finish-search-result:${taskKey}`, JSON.stringify(combined));
      } catch {
        // ignore — storage unavailable
      }
      if (newOnes.length === 0) {
        notify("success", previous.length > 0 ? "No other distinct product found." : "No confident product match found on the web.");
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Product search failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="rounded-lg border border-blueprint/10 p-2 text-sm">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onCheckedChange(e.target.checked)} />
        <span className="flex-1">
          <span className="font-medium text-blueprint-dark">{item.name}</span>
          <span className={`ml-2 ${CONFIDENCE_STYLE[item.confidence]}`}>{item.confidence} confidence</span>
          {added && <span className="badge-sage ml-2">sent</span>}
          <br />
          <span className="text-xs text-blueprint/60">
            {item.category}
            {item.color && ` · ${item.color}`} — {item.description}
          </span>
        </span>
      </label>

      <div className="ml-7 mt-2">
        {!matches && (
          <button className="btn-ghost text-xs" onClick={handleSearch} disabled={searching}>
            {searching ? "Searching the web…" : "Find real product match ↗"}
          </button>
        )}

        {matches && matches.length === 0 && (
          <div className="space-y-1">
            <p className="text-xs text-blueprint/50">No confident match found on the web.</p>
            <button className="btn-ghost text-xs" onClick={handleSearch} disabled={searching}>
              {searching ? "Searching…" : "Search again"}
            </button>
          </div>
        )}

        {matches && matches.length > 0 && (
          <div className="space-y-1.5">
            {matches.map((m, mi) => {
              const isSelected = selectedMatch === m;
              return (
                <label
                  key={mi}
                  className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${
                    isSelected ? "border-amber bg-amber/5" : "border-blueprint/10"
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-0.5"
                    checked={isSelected}
                    onChange={() => onMatchSelected(isSelected ? null : m)}
                  />
                  <span className="flex-1">
                    <span className="font-medium text-blueprint-dark">
                      {m.brand}
                      {m.model && ` ${m.model}`}
                    </span>
                    <span className={`ml-2 ${MATCH_CONFIDENCE_STYLE[m.match_confidence]}`}>{m.match_confidence} match</span>
                    {m.price != null && <span className="ml-2 text-blueprint/60">{currency(m.price)}</span>}
                    <br />
                    <span className="text-blueprint/60">{m.description}</span>
                    {m.url && (
                      <>
                        {" · "}
                        <a href={m.url} target="_blank" rel="noreferrer" className="text-amber-dark hover:underline">
                          {m.retailer ?? "View product"}
                        </a>
                      </>
                    )}
                  </span>
                </label>
              );
            })}
            <button className="btn-ghost text-xs" onClick={handleSearch} disabled={searching}>
              {searching ? "Searching…" : "Search again"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
