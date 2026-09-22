"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";
import {
  saveRoughInCapture,
  addRoughInMedia,
  deleteRoughInMedia,
  deleteRoughInCapture,
} from "@/app/projects/[id]/rooms/actions";
import type { RoomWithRelations, RoughInCapture } from "@/app/projects/[id]/rooms/room-types";

const TRADE_OPTIONS = ["Framing", "Rough plumbing", "Rough electrical", "Rough HVAC", "Low voltage / data"];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function RoughInPanel({
  projectId,
  room,
  onRoomUpdated,
}: {
  projectId: string;
  room: RoomWithRelations;
  onRoomUpdated: (room: RoomWithRelations) => void;
}) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [deletingCapture, setDeletingCapture] = useState<RoughInCapture | null>(null);
  const [deletingMedia, setDeletingMedia] = useState<{ captureId: string; mediaId: string } | null>(null);

  const captures = [...room.rough_in_captures].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-blueprint-dark">Rough-in documentation</h4>
          <p className="text-xs text-blueprint/50">
            Photos and video of what&apos;s behind the wall — framing, plumbing, electrical — captured before drywall
            goes up.
          </p>
        </div>
        <button className="btn-outline shrink-0 text-xs" onClick={() => setOpen(true)}>
          + Document rough-in
        </button>
      </div>

      {captures.length === 0 ? (
        <p className="text-xs text-blueprint/50">Nothing documented yet for this room.</p>
      ) : (
        <div className="space-y-3">
          {captures.map((c) => (
            <CaptureCard
              key={c.id}
              capture={c}
              onDeleteCapture={() => setDeletingCapture(c)}
              onDeleteMedia={(mediaId) => setDeletingMedia({ captureId: c.id, mediaId })}
            />
          ))}
        </div>
      )}

      {open && (
        <AddCaptureModal
          projectId={projectId}
          room={room}
          onClose={() => setOpen(false)}
          onSaved={(capture) => {
            onRoomUpdated({ ...room, rough_in_captures: [capture, ...room.rough_in_captures] });
            notify("success", "Rough-in documented.");
            setOpen(false);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deletingCapture}
        title="Delete this rough-in record?"
        message={`Every photo and video from this walkthrough (${formatDate(deletingCapture?.created_at ?? new Date().toISOString())}) will be permanently removed.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeletingCapture(null)}
        onConfirm={async () => {
          if (!deletingCapture) return;
          const res = await deleteRoughInCapture(projectId, deletingCapture.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete this record.");
          } else {
            onRoomUpdated({
              ...room,
              rough_in_captures: room.rough_in_captures.filter((c) => c.id !== deletingCapture.id),
            });
          }
          setDeletingCapture(null);
        }}
      />

      <ConfirmDialog
        open={!!deletingMedia}
        title="Delete this file?"
        message="This photo or video will be permanently removed."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeletingMedia(null)}
        onConfirm={async () => {
          if (!deletingMedia) return;
          const res = await deleteRoughInMedia(projectId, deletingMedia.mediaId);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete this file.");
          } else {
            onRoomUpdated({
              ...room,
              rough_in_captures: room.rough_in_captures.map((c) =>
                c.id === deletingMedia.captureId
                  ? { ...c, rough_in_media: c.rough_in_media.filter((m) => m.id !== deletingMedia.mediaId) }
                  : c
              ),
            });
          }
          setDeletingMedia(null);
        }}
      />
    </div>
  );
}

function CaptureCard({
  capture,
  onDeleteCapture,
  onDeleteMedia,
}: {
  capture: RoughInCapture;
  onDeleteCapture: () => void;
  onDeleteMedia: (mediaId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-blueprint/10 p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-blueprint-dark">{formatDate(capture.created_at)}</p>
          {capture.trades.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {capture.trades.map((t) => (
                <span key={t} className="badge bg-blueprint/10 text-blueprint/60">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <button className="shrink-0 text-xs text-red-500 hover:underline" onClick={onDeleteCapture}>
          Delete
        </button>
      </div>

      {capture.notes && <p className="mb-2 whitespace-pre-wrap text-xs text-blueprint/70">{capture.notes}</p>}

      {capture.rough_in_media.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {capture.rough_in_media.map((m) => (
            <div key={m.id} className="group relative aspect-video overflow-hidden rounded-md bg-concrete">
              {m.media_type === "video" ? (
                <video src={m.storage_url} controls className="h-full w-full object-cover" />
              ) : (
                <a href={m.storage_url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URLs aren't valid next/image remote sources */}
                  <img src={m.storage_url} alt={m.file_name ?? "Rough-in photo"} className="h-full w-full object-cover" />
                </a>
              )}
              <button
                className="absolute right-1 top-1 hidden rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white group-hover:block"
                onClick={() => onDeleteMedia(m.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddCaptureModal({
  projectId,
  room,
  onClose,
  onSaved,
}: {
  projectId: string;
  room: RoomWithRelations;
  onClose: () => void;
  onSaved: (capture: RoughInCapture) => void;
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const taskKey = `rough-in-save:${room.id}`;
  const [trades, setTrades] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const saving = isRunning(taskKey);

  function toggleTrade(trade: string) {
    setTrades((prev) => {
      const next = new Set(prev);
      if (next.has(trade)) next.delete(trade);
      else next.add(trade);
      return next;
    });
  }

  async function handleSave() {
    try {
      await run(taskKey, `Saving rough-in documentation for "${room.name}"…`, async () => {
        setStatus("Saving…");
        const captureRes = await saveRoughInCapture(projectId, room.id, {
          roomLabel: room.name,
          trades: Array.from(trades),
          notes: notes.trim() || null,
        });
        if (!captureRes.ok || !captureRes.id) throw new Error(captureRes.error ?? "Could not save.");
        const captureId = captureRes.id;

        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in.");

        const media: RoughInCapture["rough_in_media"] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setStatus(`Uploading ${i + 1}/${files.length}…`);
          const mediaType = file.type.startsWith("video/") ? "video" : "photo";
          const path = `${user.id}/${projectId}/${captureId}-${Date.now()}-${file.name}`;
          const { error: uploadError } = await supabase.storage.from("rough-in-media").upload(path, file, {
            contentType: file.type || undefined,
          });
          if (uploadError) throw new Error(uploadError.message);
          const { data: pub, error: signError } = await supabase.storage
            .from("rough-in-media")
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
          if (signError || !pub) throw new Error(signError?.message ?? "Could not get a URL for the uploaded file.");

          const mediaRes = await addRoughInMedia(projectId, captureId, {
            mediaType,
            storageUrl: pub.signedUrl,
            fileName: file.name,
          });
          if (!mediaRes.ok || !mediaRes.id) throw new Error(mediaRes.error ?? "Could not save an uploaded file.");
          media.push({
            id: mediaRes.id,
            media_type: mediaType,
            storage_url: pub.signedUrl,
            file_name: file.name,
            created_at: new Date().toISOString(),
          });
        }

        onSaved({
          id: captureId,
          room_label: room.name,
          trades: Array.from(trades),
          notes: notes.trim() || null,
          created_at: new Date().toISOString(),
          rough_in_media: media,
        });
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not save rough-in documentation.");
    } finally {
      setStatus("");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Document rough-in — ${room.name}`}
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? status || "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">What&apos;s covered</label>
          <div className="flex flex-wrap gap-2">
            {TRADE_OPTIONS.map((trade) => (
              <label
                key={trade}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                  trades.has(trade) ? "border-amber bg-amber/15 text-amber-dark" : "border-blueprint/15 text-blueprint/60"
                }`}
              >
                <input type="checkbox" className="hidden" checked={trades.has(trade)} onChange={() => toggleTrade(trade)} />
                {trade}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <textarea
            className="input"
            rows={3}
            placeholder={`Anything worth flagging — e.g. "2 supply lines run along the east stud bay, electrical panel is on the north wall"`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Photos & video</label>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            className="input"
            disabled={saving}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 && <p className="mt-1 text-xs text-blueprint/50">{files.length} file(s) selected.</p>}
          <p className="mt-1 text-xs text-blueprint/50">
            A large video may take a while to upload, and very large files can hit Supabase Storage&apos;s per-file size
            limit — raise it in the Supabase dashboard if needed.
          </p>
        </div>
      </div>
    </Modal>
  );
}
