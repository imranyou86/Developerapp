"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { addFinish } from "@/app/projects/[id]/rooms/actions";
import { deleteFinishScan, saveFinishScan } from "@/app/projects/[id]/finish-id/actions";
import type { FinishCategory, IdentifiedFinish } from "@/lib/types";

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

export function FinishIdClient({
  projectId,
  rooms,
  initialScans,
}: {
  projectId: string;
  rooms: RoomOption[];
  initialScans: FinishScanRow[];
}) {
  const { notify } = useToast();
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
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const path = `${user.id}/${projectId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("finish-scans").upload(path, file, {
        contentType: file.type,
      });
      if (uploadError) throw new Error(uploadError.message);

      const { data: pub } = supabase.storage.from("finish-scans").getPublicUrl(path);

      setUploadStatus("Identifying finishes…");
      const res = await fetch("/api/claude/identify-finishes", {
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

      const saveRes = await saveFinishScan(projectId, pub.publicUrl, file.name, results);
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
              Upload any photo or screenshot — a listing photo, a Pinterest screenshot, a snapshot
              from a showroom — and Claude will identify the stone, tile, faucets, paint, and other
              finishes it can see, so you can add the ones you like straight to a room.
            </p>
          </div>
          <button className="btn-amber" onClick={() => fileInputRef.current?.click()} disabled={uploading || rooms.length === 0}>
            {uploading ? uploadStatus || "Working…" : "Upload photo"}
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
        {rooms.length === 0 && (
          <p className="mt-2 text-xs text-amber-dark">Add a room first (Rooms &amp; Tasks tab) so identified finishes have somewhere to go.</p>
        )}
      </div>

      {scans.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">No scans yet.</div>
      ) : (
        <div className="space-y-4">
          {scans.map((scan) => (
            <ScanCard
              key={scan.id}
              projectId={projectId}
              scan={scan}
              rooms={rooms}
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
        message="This photo and its identified finishes list will be permanently removed. Anything already added to a room's Finishes list stays there."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteFinishScan(projectId, deleting.id);
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
  projectId,
  scan,
  rooms,
  expanded,
  onToggle,
  onDelete,
}: {
  projectId: string;
  scan: FinishScanRow;
  rooms: RoomOption[];
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { notify } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set(scan.results.map((_, i) => i)));
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Set<number>>(new Set());

  async function handleAddSelected() {
    if (!roomId || selected.size === 0) return;
    setAdding(true);
    try {
      const indices = Array.from(selected);
      for (const i of indices) {
        const item = scan.results[i];
        const res = await addFinish(projectId, roomId, {
          name: item.name,
          category: item.category as FinishCategory,
          brand: item.color ? `${item.color} — ${item.description}` : item.description,
          price: null,
        });
        if (!res.ok) throw new Error(res.error ?? `Could not add "${item.name}".`);
      }
      setAdded((prev) => new Set([...prev, ...indices]));
      notify("success", `Added ${indices.length} item(s) to the room's finishes.`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not add items.");
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
              <div className="space-y-2">
                {scan.results.map((item, i) => (
                  <label key={i} className="flex items-start gap-3 rounded-lg border border-blueprint/10 p-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(i)}
                      disabled={added.has(i)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                          return next;
                        })
                      }
                    />
                    <span className="flex-1">
                      <span className="font-medium text-blueprint-dark">{item.name}</span>
                      <span className={`ml-2 ${CONFIDENCE_STYLE[item.confidence]}`}>{item.confidence} confidence</span>
                      {added.has(i) && <span className="badge-sage ml-2">added</span>}
                      <br />
                      <span className="text-xs text-blueprint/60">
                        {item.category}
                        {item.color && ` · ${item.color}`} — {item.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {rooms.length > 0 && (
                <div className="flex items-center gap-2 border-t border-blueprint/10 pt-3">
                  <select className="input flex-1" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn-primary" onClick={handleAddSelected} disabled={adding || selected.size === 0}>
                    {adding ? "Adding…" : `Add ${selected.size} to room`}
                  </button>
                </div>
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
