"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DEFAULT_PALETTE_COLORS } from "@/lib/styles";
import type { StylePalette } from "@/lib/styles";
import { buildRoomIllustration } from "@/lib/illustration";
import { deleteRendering, saveRendering, saveRenderingPhoto } from "@/app/projects/[id]/rooms/actions";
import { saveFinishScan } from "@/app/interior-design/finish-id-actions";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { FINISH_CATEGORIES } from "@/lib/finishes-db";
import type { PlanPageOption, RoomWithRelations } from "@/app/projects/[id]/rooms/room-types";
import type { IdentifiedFinish, StyleName } from "@/lib/types";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";

const FINISH_CATEGORY_SET = new Set<string>(FINISH_CATEGORIES);

type ConceptTarget = "gemini" | "midjourney";

interface QueuedStyle {
  id: string;
  name: string;
  wall: string;
  floor: string;
  accent: string;
  target: ConceptTarget;
}

export function RenderingPanel({
  projectId,
  room,
  planPages,
  onRoomUpdated,
}: {
  projectId: string;
  room: RoomWithRelations;
  planPages: PlanPageOption[];
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

  // Free-text style + custom colors, queued up before a single "Build" — no
  // preset list at all: DEFAULT_PALETTE_COLORS just seeds a sensible
  // starting color set for the pickers.
  const [styleInput, setStyleInput] = useState("");
  const [wallColor, setWallColor] = useState(DEFAULT_PALETTE_COLORS.wall);
  const [floorColor, setFloorColor] = useState(DEFAULT_PALETTE_COLORS.floor);
  const [accentColor, setAccentColor] = useState(DEFAULT_PALETTE_COLORS.accent);
  // Picked once per style before queuing, not asked for both every time —
  // Gemini auto-generates an image in this app; Midjourney is copy-paste
  // only, so generating its prompt when nobody's going to use it (or vice
  // versa) is wasted Claude output.
  const [targetInput, setTargetInput] = useState<ConceptTarget>("gemini");
  const [queue, setQueue] = useState<QueuedStyle[]>([]);
  const [building, setBuilding] = useState(false);
  // Local overrides of a rendering's Claude-written image_prompt, keyed by
  // rendering id — "write your own prompt" without needing a DB round trip
  // just to try wording before generating; "Generate image (AI)" sends
  // whichever text is in the box, not necessarily the original.
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>({});
  const [addToImagePromptFor, setAddToImagePromptFor] = useState<string | null>(null);
  const [addToImageText, setAddToImageText] = useState("");
  const [addingToImage, setAddingToImage] = useState<string | null>(null);

  function addToQueue() {
    const name = styleInput.trim();
    if (!name) return;
    setQueue((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name, wall: wallColor, floor: floorColor, accent: accentColor, target: targetInput },
    ]);
    setStyleInput("");
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }

  async function handleBuildQueue() {
    if (queue.length === 0) return;
    setBuilding(true);
    // Threaded through the loop (rather than each call reading the `room`
    // prop off the closure) so generating several queued styles back to
    // back doesn't have each onRoomUpdated call overwrite the previous
    // entry — the prop only updates on the parent's next render, which
    // hasn't happened yet mid-loop.
    let currentRoom = room;
    for (const entry of queue) {
      currentRoom = await handleGenerate(entry, currentRoom);
    }
    setBuilding(false);
    setQueue([]);
  }

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
        const saveRes = await saveFinishScan(rendering.uploaded_photo_url!, label, results);
        if (!saveRes.ok) throw new Error(saveRes.error ?? "Could not save scan.");

        notify(
          "success",
          results.length === 0
            ? "Sent to Finish ID — no identifiable finishes found."
            : `Sent to Finish ID — identified ${results.length} finish(es).`
        );
        router.push(`/interior-design`);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not send to Finish ID.");
    } finally {
      setSendingToFinishId(null);
    }
  }

  async function uploadPhotoBlob(renderingId: string, blob: Blob, fileExt: string, imagePrompt?: string) {
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

    const { data: pub, error: pubSignError } = await supabase.storage
      .from("rendering-photos")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (pubSignError || !pub) throw new Error(pubSignError?.message ?? "Could not get a URL for the uploaded file.");
    const style = room.renderings.find((r) => r.id === renderingId)?.style;
    const label = style ? `${room.name} — ${style}` : room.name;
    const res = await saveRenderingPhoto(projectId, renderingId, pub.signedUrl, label, imagePrompt);
    if (!res.ok) throw new Error(res.error ?? "Could not save photo.");
    return pub.signedUrl;
  }

  async function handleGenerateImage(rendering: RoomWithRelations["renderings"][number]) {
    const prompt = promptOverrides[rendering.id] ?? rendering.image_prompt;
    if (!prompt || !prompt.trim()) return;
    setGeneratingImageFor(rendering.id);
    const taskKey = `room-image:${rendering.id}`;
    // A from-scratch text-to-image call has no idea what this room actually
    // looks like — it can only follow the room's real layout once there's a
    // real photo of it to anchor on. Once one exists (uploaded, or from an
    // earlier generation here), re-running this keeps that same photo's
    // architecture/walls/camera framing and only restyles it, via the same
    // image-editing path "Add to this image" uses, instead of discarding
    // the room's real shape and inventing a new one from text alone. Short
    // of a real photo, the next best layout signal is the construction's
    // own floor plan sheet(s) — when those exist, Gemini is asked to find
    // this room on the plan and use its real wall/window/door layout,
    // rather than falling all the way back to a generic room description.
    const hasReferencePhoto = !!rendering.uploaded_photo_url;
    try {
      await run(taskKey, `Generating "${room.name}" — ${rendering.style} image…`, async () => {
        const res = await fetchWithRetry(
          hasReferencePhoto ? "/api/gemini/edit-room-image" : "/api/gemini/generate-room-image",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              hasReferencePhoto
                ? {
                    imageUrl: rendering.uploaded_photo_url,
                    prompt: `Keep this exact room's architecture, walls, windows, and camera framing unchanged — only restyle the finishes, furniture, and decor to match: ${prompt}`,
                  }
                : {
                    prompt,
                    planImageUrls: planPages.length > 0 ? planPages.map((p) => p.storage_url) : undefined,
                    roomName: room.name,
                    floor: room.floor,
                  }
            ),
          }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Image generation failed.");

        const byteChars = atob(json.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: json.mimeType ?? "image/png" });

        // Persist whatever prompt was actually used (the textarea override,
        // if the person edited it before generating) as the rendering's own
        // image_prompt — otherwise the stored prompt silently falls out of
        // sync with the image it supposedly describes the moment someone
        // edits it and regenerates.
        const url = await uploadPhotoBlob(rendering.id, blob, "png", prompt);
        onRoomUpdated({
          ...room,
          renderings: room.renderings.map((r) =>
            r.id === rendering.id ? { ...r, uploaded_photo_url: url, image_prompt: prompt } : r
          ),
        });
        setPromptOverrides((prev) => {
          const next = { ...prev };
          delete next[rendering.id];
          return next;
        });
        notify("success", "AI image generated.");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Image generation failed.");
    } finally {
      setGeneratingImageFor(null);
    }
  }

  // Refines the CURRENT image (whatever's in uploaded_photo_url right now —
  // the last AI generation or edit, not necessarily the original) with a
  // follow-up instruction, chaining edits rather than starting over from
  // scratch each time.
  async function handleAddToImage(rendering: RoomWithRelations["renderings"][number]) {
    if (!rendering.uploaded_photo_url || !addToImageText.trim()) return;
    setAddingToImage(rendering.id);
    const taskKey = `room-image-add:${rendering.id}`;
    try {
      await run(taskKey, `Adding to "${room.name}" — ${rendering.style} image…`, async () => {
        const res = await fetchWithRetry("/api/gemini/edit-room-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: rendering.uploaded_photo_url, prompt: addToImageText.trim() }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Image edit failed.");

        const byteChars = atob(json.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: json.mimeType ?? "image/png" });

        // Append rather than overwrite — image_prompt should keep
        // describing everything actually in the photo, not just the most
        // recent edit, so "Copy prompt" still reflects the full picture.
        const updatedPrompt = rendering.image_prompt
          ? `${rendering.image_prompt}\n\nUpdate: ${addToImageText.trim()}`
          : addToImageText.trim();

        const url = await uploadPhotoBlob(rendering.id, blob, "png", updatedPrompt);
        onRoomUpdated({
          ...room,
          renderings: room.renderings.map((r) =>
            r.id === rendering.id ? { ...r, uploaded_photo_url: url, image_prompt: updatedPrompt } : r
          ),
        });
        setPromptOverrides((prev) => {
          const next = { ...prev };
          delete next[rendering.id];
          return next;
        });
        notify("success", "Image updated.");
        setAddToImagePromptFor(null);
        setAddToImageText("");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Image edit failed.");
    } finally {
      setAddingToImage(null);
    }
  }

  async function handleGenerate(entry: QueuedStyle, currentRoom: RoomWithRelations): Promise<RoomWithRelations> {
    const style = entry.name;
    setGenerating(style);
    const taskKey = `room-concept:${room.id}:${entry.id}`;
    let nextRoom = currentRoom;
    try {
      await run(taskKey, `Generating "${room.name}" — ${style} concept…`, async () => {
        const palette: StylePalette = {
          name: style,
          colors: [entry.wall, entry.accent, entry.floor],
          wall: entry.wall,
          floor: entry.floor,
          accent: entry.accent,
          description: "",
        };
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
            target: entry.target,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Concept generation failed.");

        const saveRes = await saveRendering(projectId, room.id, {
          style,
          colors: palette.colors,
          description: json.description,
          image_prompt: json.image_prompt,
          midjourney_prompt: json.midjourney_prompt,
          illustration_svg,
        });
        if (!saveRes.ok) throw new Error(saveRes.error ?? "Could not save rendering.");

        nextRoom = {
          ...currentRoom,
          renderings: [
            {
              id: crypto.randomUUID(),
              style,
              colors: palette.colors,
              description: json.description,
              image_prompt: json.image_prompt,
              midjourney_prompt: json.midjourney_prompt,
              illustration_svg,
              uploaded_photo_url: null,
              created_at: new Date().toISOString(),
            },
            ...currentRoom.renderings,
          ],
        };
        onRoomUpdated(nextRoom);
        notify("success", `Generated a ${style} rendering.`);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Rendering generation failed.");
    } finally {
      setGenerating(null);
    }
    return nextRoom;
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
      <div className="mb-4 space-y-3 rounded-lg border border-blueprint/10 bg-concrete/50 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <label className="label">Style</label>
            <input
              className="input"
              value={styleInput}
              onChange={(e) => setStyleInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addToQueue())}
              placeholder="e.g. Coastal, Japandi, Mid-Century Modern…"
            />
          </div>
          <div>
            <label className="label">Wall</label>
            <input
              type="color"
              value={wallColor}
              onChange={(e) => setWallColor(e.target.value)}
              className="h-9 w-11 cursor-pointer rounded-lg border border-blueprint/20 bg-white p-0.5"
            />
          </div>
          <div>
            <label className="label">Floor</label>
            <input
              type="color"
              value={floorColor}
              onChange={(e) => setFloorColor(e.target.value)}
              className="h-9 w-11 cursor-pointer rounded-lg border border-blueprint/20 bg-white p-0.5"
            />
          </div>
          <div>
            <label className="label">Accent</label>
            <input
              type="color"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              className="h-9 w-11 cursor-pointer rounded-lg border border-blueprint/20 bg-white p-0.5"
            />
          </div>
          <div className="min-w-[150px]">
            <label className="label">Generate</label>
            <select
              className="input py-1.5 text-xs"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value as ConceptTarget)}
            >
              <option value="gemini">Image (this app, via Gemini)</option>
              <option value="midjourney">Midjourney prompt only</option>
            </select>
          </div>
          <button className="btn-outline text-xs" disabled={!styleInput.trim() || building} onClick={addToQueue}>
            + Add to list
          </button>
        </div>

        {queue.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-blueprint/10 pt-3">
            {queue.map((q) => (
              <span
                key={q.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-blueprint/15 bg-white py-1 pl-1 pr-2 text-xs"
              >
                <span className="flex">
                  {[q.wall, q.accent, q.floor].map((c, i) => (
                    <span
                      key={i}
                      className="-ml-1 h-3 w-3 rounded-full border border-white first:ml-0"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                {q.name}
                {q.target === "midjourney" && (
                  <span className="rounded bg-amber/10 px-1 text-[10px] font-medium text-amber-dark">MJ</span>
                )}
                <button
                  className="ml-0.5 text-blueprint/40 hover:text-red-500"
                  onClick={() => removeFromQueue(q.id)}
                  aria-label={`Remove ${q.name} from the list`}
                  disabled={building}
                >
                  ×
                </button>
              </span>
            ))}
            <button className="btn-amber text-xs" disabled={building} onClick={handleBuildQueue}>
              {building
                ? `Building "${generating}"…`
                : `Build design${queue.length > 1 ? "s" : ""} (${queue.length})`}
            </button>
          </div>
        )}
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
                <div className="flex items-center gap-2">
                  {r.image_prompt && (
                    <button
                      type="button"
                      className="text-xs text-amber-dark hover:underline"
                      onClick={() => handleCopyPrompt(promptOverrides[r.id] ?? r.image_prompt!)}
                      title="Copy the current image prompt without opening the editor below"
                    >
                      Copy prompt
                    </button>
                  )}
                  <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(r.id)}>
                    Delete
                  </button>
                </div>
              </div>
              {r.description && <p className="mb-2 text-xs text-blueprint/70">{r.description}</p>}
              {r.image_prompt && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-amber-dark">Image prompt — edit before generating</summary>
                  <textarea
                    className="input mt-1 text-xs"
                    rows={4}
                    value={promptOverrides[r.id] ?? r.image_prompt}
                    onChange={(e) => setPromptOverrides((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  />
                </details>
              )}
              {r.midjourney_prompt && (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-amber-dark">Midjourney prompt — paste into Midjourney</summary>
                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-concrete/60 p-2 text-blueprint/70">{r.midjourney_prompt}</p>
                  <button className="btn-ghost mt-1 text-xs" onClick={() => handleCopyPrompt(r.midjourney_prompt!)}>
                    Copy Midjourney prompt
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
                    {generatingImageFor === r.id || isRunning(`room-image:${r.id}`)
                      ? "Generating…"
                      : r.uploaded_photo_url
                        ? "Regenerate (keep this room's layout)"
                        : "Generate image (AI)"}
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
                      className="btn-outline flex-1 text-xs"
                      onClick={() => setAddToImagePromptFor(addToImagePromptFor === r.id ? null : r.id)}
                    >
                      Add to this image
                    </button>
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
              {addToImagePromptFor === r.id && (
                <div className="mt-2 space-y-1.5 border-t border-blueprint/10 pt-2">
                  <textarea
                    className="input text-xs"
                    rows={2}
                    placeholder={`Describe what to add or change — e.g. "add a potted plant in the corner, and a rug under the coffee table"`}
                    value={addToImageText}
                    onChange={(e) => setAddToImageText(e.target.value)}
                    autoFocus
                  />
                  <button
                    className="btn-amber w-full text-xs"
                    onClick={() => handleAddToImage(r)}
                    disabled={!addToImageText.trim() || addingToImage === r.id || isRunning(`room-image-add:${r.id}`)}
                  >
                    {addingToImage === r.id || isRunning(`room-image-add:${r.id}`) ? "Updating…" : "Update image"}
                  </button>
                </div>
              )}
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
