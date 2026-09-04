"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { STYLE_PALETTES, getPalette } from "@/lib/styles";
import { buildRoomIllustration } from "@/lib/illustration";
import { deleteRendering, saveRendering, saveRenderingPhoto } from "@/app/projects/[id]/rooms/actions";
import { saveFinishScan } from "@/app/projects/[id]/finish-id/actions";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { FINISH_CATEGORIES } from "@/lib/finishes-db";
import type { RoomWithRelations } from "@/app/projects/[id]/rooms/room-types";
import type { IdentifiedFinish, StyleName } from "@/lib/types";

const FINISH_CATEGORY_SET = new Set<string>(FINISH_CATEGORIES);

export function RenderingPanel({
  projectId,
  room,
  onRoomUpdated,
}: {
  projectId: string;
  room: RoomWithRelations;
  onRoomUpdated: (room: RoomWithRelations) => void;
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const router = useRouter();
  const [generating, setGenerating] = useState<StyleName | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null);
  const [generatingImageFor, setGeneratingImageFor] = useState<string | null>(null);
  const [sendingToFinishId, setSendingToFinishId] = useState<string | null>(null);

  async function handleCopyPrompt(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      notify("success", "Prompt copied.");
    } catch {
      notify("error", "Could not copy — your browser blocked clipboard access.");
    }
  }

  async function handleSaveImage(url: string, label: string) {
    try {
      const res = await fetchWithRetry(url);
      if (!res.ok) throw new Error("Could not fetch the image.");
      const blob = await res.blob();
      const ext = blob.type.split("/")[1]?.split("+")[0] || "png";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${label.replace(/[^a-z0-9]+/gi, "-")}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not save image.");
    }
  }

  async function handleSendToFinishId(rendering: RoomWithRelations["renderings"][number]) {
    if (!rendering.uploaded_photo_url) return;
    setSendingToFinishId(rendering.id);
    const taskKey = `send-to-finish-id:${rendering.id}`;
    try {
      await run(taskKey, `Analyzing "${room.name}" — ${rendering.style} for finishes…`, async () => {
        const res = await fetchWithRetry("/api/claude/identify-finishes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: rendering.uploaded_photo_url }),
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

        const label = `${room.name} — ${rendering.style}`;
        const saveRes = await saveFinishScan(projectId, rendering.uploaded_photo_url!, label, results);
        if (!saveRes.ok) throw new Error(saveRes.error ?? "Could not save scan.");

        notify(
          "success",
          results.length === 0
            ? "Sent to Finish ID — no identifiable finishes found."
            : `Sent to Finish ID — identified ${results.length} finish(es).`
        );
        router.push(`/projects/${projectId}/finish-id`);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not send to Finish ID.");
    } finally {
      setSendingToFinishId(null);
    }
  }

  async function uploadPhotoBlob(renderingId: string, blob: Blob, fileExt: string) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");

    const path = `${user.id}/${projectId}/${renderingId}-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from("rendering-photos").upload(path, blob, {
      contentType: blob.type,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data: pub } = supabase.storage.from("rendering-photos").getPublicUrl(path);
    const style = room.renderings.find((r) => r.id === renderingId)?.style;
    const label = style ? `${room.name} — ${style}` : room.name;
    const res = await saveRenderingPhoto(projectId, renderingId, pub.publicUrl, label);
    if (!res.ok) throw new Error(res.error ?? "Could not save photo.");
    return pub.publicUrl;
  }

  async function handleGenerateImage(rendering: RoomWithRelations["renderings"][number]) {
    if (!rendering.image_prompt) return;
    setGeneratingImageFor(rendering.id);
    const taskKey = `room-image:${rendering.id}`;
    try {
      await run(taskKey, `Generating "${room.name}" — ${rendering.style} image…`, async () => {
        const res = await fetchWithRetry("/api/openai/generate-room-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: rendering.image_prompt }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Image generation failed.");

        const byteChars = atob(json.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: json.mimeType ?? "image/png" });

        const url = await uploadPhotoBlob(rendering.id, blob, "png");
        onRoomUpdated({
          ...room,
          renderings: room.renderings.map((r) => (r.id === rendering.id ? { ...r, uploaded_photo_url: url } : r)),
        });
        notify("success", "AI image generated.");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Image generation failed.");
    } finally {
      setGeneratingImageFor(null);
    }
  }

  async function handleGenerate(style: StyleName) {
    setGenerating(style);
    const taskKey = `room-concept:${room.id}:${style}`;
    try {
      await run(taskKey, `Generating "${room.name}" — ${style} concept…`, async () => {
        const palette = getPalette(style);
        const illustration_svg = buildRoomIllustration(room.name, palette);

        const res = await fetchWithRetry("/api/claude/room-concept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomName: room.name,
            roomType: room.type,
            style,
            width: room.width,
            depth: room.depth,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Concept generation failed.");

        const saveRes = await saveRendering(projectId, room.id, {
          style,
          colors: palette.colors,
          description: json.description,
          image_prompt: json.image_prompt,
          illustration_svg,
        });
        if (!saveRes.ok) throw new Error(saveRes.error ?? "Could not save rendering.");

        onRoomUpdated({
          ...room,
          renderings: [
            {
              id: crypto.randomUUID(),
              style,
              colors: palette.colors,
              description: json.description,
              image_prompt: json.image_prompt,
              illustration_svg,
              uploaded_photo_url: null,
              created_at: new Date().toISOString(),
            },
            ...room.renderings,
          ],
        });
        notify("success", `Generated a ${style} rendering.`);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Rendering generation failed.");
    } finally {
      setGenerating(null);
    }
  }

  async function handlePhotoUpload(renderingId: string, file: File) {
    setUploadingPhotoFor(renderingId);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const url = await uploadPhotoBlob(renderingId, file, ext);
      onRoomUpdated({
        ...room,
        renderings: room.renderings.map((r) => (r.id === renderingId ? { ...r, uploaded_photo_url: url } : r)),
      });
      notify("success", "Photo added — it now replaces the illustration.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Photo upload failed.");
    } finally {
      setUploadingPhotoFor(null);
    }
  }

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-blueprint-dark">Style rendering</h4>
      <div className="mb-4 flex flex-wrap gap-2">
        {STYLE_PALETTES.map((p) => (
          <button
            key={p.name}
            className="btn-outline text-xs"
            disabled={generating !== null || isRunning(`room-concept:${room.id}:${p.name}`)}
            onClick={() => handleGenerate(p.name)}
          >
            {generating === p.name || isRunning(`room-concept:${room.id}:${p.name}`) ? "Generating…" : p.name}
            <span className="ml-1.5 flex">
              {p.colors.slice(0, 3).map((c) => (
                <span key={c} className="-ml-1 h-3 w-3 rounded-full border border-white" style={{ backgroundColor: c }} />
              ))}
            </span>
          </button>
        ))}
      </div>

      {room.renderings.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {room.renderings.map((r) => (
            <div key={r.id} className="rounded-lg border border-blueprint/10 p-3">
              <div className="relative mb-2 aspect-[4/3] overflow-hidden rounded-md bg-concrete">
                {r.uploaded_photo_url ? (
                  <Image src={r.uploaded_photo_url} alt={r.style} fill className="object-cover" unoptimized />
                ) : r.illustration_svg ? (
                  <div
                    className="h-full w-full"
                    dangerouslySetInnerHTML={{ __html: r.illustration_svg }}
                  />
                ) : null}
              </div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-blueprint-dark">{r.style}</span>
                <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(r.id)}>
                  Delete
                </button>
              </div>
              {r.description && <p className="mb-2 text-xs text-blueprint/70">{r.description}</p>}
              {r.image_prompt && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-amber-dark">Image prompt (used by &quot;Generate image&quot;, or copy to ChatGPT/Midjourney by hand)</summary>
                  <p className="mt-1 whitespace-pre-wrap rounded bg-concrete p-2 text-blueprint/70">{r.image_prompt}</p>
                  <button
                    className="btn-ghost mt-1 text-xs"
                    onClick={() => handleCopyPrompt(r.image_prompt!)}
                  >
                    Copy prompt
                  </button>
                </details>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.image_prompt && (
                  <button
                    className="btn-amber flex-1 text-xs"
                    onClick={() => handleGenerateImage(r)}
                    disabled={generatingImageFor === r.id || isRunning(`room-image:${r.id}`)}
                  >
                    {generatingImageFor === r.id || isRunning(`room-image:${r.id}`) ? "Generating…" : "Generate image (AI)"}
                  </button>
                )}
                <input
                  ref={(el) => {
                    fileInputs.current[r.id] = el;
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePhotoUpload(r.id, file);
                  }}
                />
                <button
                  className="btn-ghost flex-1 text-xs"
                  onClick={() => fileInputs.current[r.id]?.click()}
                  disabled={uploadingPhotoFor === r.id}
                >
                  {uploadingPhotoFor === r.id
                    ? "Uploading…"
                    : r.uploaded_photo_url
                      ? "Replace photo"
                      : "Upload photo"}
                </button>
                {r.uploaded_photo_url && (
                  <>
                    <button
                      className="btn-ghost flex-1 text-xs"
                      onClick={() => handleSaveImage(r.uploaded_photo_url!, `${room.name}-${r.style}`)}
                    >
                      Save image
                    </button>
                    <button
                      className="btn-ghost flex-1 text-xs"
                      onClick={() => handleSendToFinishId(r)}
                      disabled={sendingToFinishId === r.id || isRunning(`send-to-finish-id:${r.id}`)}
                    >
                      {sendingToFinishId === r.id || isRunning(`send-to-finish-id:${r.id}`)
                        ? "Sending…"
                        : "Send to Finish ID"}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete rendering?"
        message="This rendering and its uploaded photo (if any) will be permanently removed."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteRendering(projectId, deleting);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete rendering.");
          } else {
            onRoomUpdated({ ...room, renderings: room.renderings.filter((r) => r.id !== deleting) });
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}
