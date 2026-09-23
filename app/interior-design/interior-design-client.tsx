"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { ROOM_TYPES, matchRoomType, type RoomTypeOption } from "@/lib/roomTypes";
import { buildInteriorDesignPrompt } from "@/lib/interiorDesignPrompt";
import { describeLayout } from "@/lib/layoutDescription";
import { LayoutEditor, clampItemsToArea } from "@/components/LayoutEditor";
import { FeetInchesInput } from "@/components/FeetInchesInput";
import { formatFeetInches } from "@/lib/feetInches";
import { stripLeadingZero } from "@/lib/numberInput";
import { getFixturesForRoomType } from "@/lib/fixtureCatalog";
import { saveInteriorDesign, deleteInteriorDesign, updateInteriorDesignImage } from "@/app/interior-design/actions";
import type { InteriorDesign, PlacedFixture } from "@/lib/types";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";

interface RoomOption {
  id: string;
  name: string;
  type: string | null;
  width: number | null;
  depth: number | null;
}

interface PlanPageOption {
  label: string;
  storage_url: string;
}

export function InteriorDesignClient({
  projectId,
  initialDesigns,
  rooms,
  planPages,
}: {
  projectId: string;
  initialDesigns: InteriorDesign[];
  rooms: RoomOption[];
  planPages: PlanPageOption[];
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const taskKey = `interior-design:${projectId}`;
  const suggestTaskKey = `interior-design-suggest:${projectId}`;

  const [designs, setDesigns] = useState<InteriorDesign[]>(initialDesigns);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const generating = submitting || isRunning(taskKey);
  const [suggesting, setSuggesting] = useState(false);
  const suggestingLayout = suggesting || isRunning(suggestTaskKey);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [roomSource, setRoomSource] = useState<"existing" | "manual">(rooms.length > 0 ? "existing" : "manual");
  const [selectedRoomId, setSelectedRoomId] = useState<string>(rooms[0]?.id ?? "");
  const [roomType, setRoomType] = useState<RoomTypeOption>(rooms[0] ? matchRoomType(rooms[0].type) : "Bedroom");
  const [style, setStyle] = useState<string>("");
  const [width, setWidth] = useState<number | null>(rooms[0]?.width ?? null);
  const [depth, setDepth] = useState<number | null>(rooms[0]?.depth ?? null);
  const [sqft, setSqft] = useState<string>("");
  const [layout, setLayout] = useState<PlacedFixture[]>([]);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptEdited, setPromptEdited] = useState(false);

  const [addToImagePromptFor, setAddToImagePromptFor] = useState<string | null>(null);
  const [addToImageText, setAddToImageText] = useState("");
  const [addingToImage, setAddingToImage] = useState<string | null>(null);

  const hasRoomDims = width != null && depth != null && width > 0 && depth > 0;
  const numWidth = width ?? 0;
  const numDepth = depth ?? 0;
  const layoutDescription = hasRoomDims ? describeLayout(layout, numWidth, numDepth) : "";
  const autoPrompt = buildInteriorDesignPrompt({
    roomType,
    style: style.trim() || "unspecified",
    width,
    depth,
    sqft: sqft ? Number(sqft) : null,
    hasPhoto: !!photoFile,
    layoutDescription,
  });

  useEffect(() => {
    if (hasRoomDims) setSqft(String(Math.round(numWidth * numDepth)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, depth]);

  // Keep placed fixtures inside the room whenever its dimensions change
  // (switching the selected pre-added room, or editing manual sizing).
  useEffect(() => {
    if (hasRoomDims) setLayout((prev) => clampItemsToArea(prev, numWidth, numDepth));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numWidth, numDepth]);

  // The prompt textarea tracks the auto-composed prompt live as the form
  // changes, unless the user has typed their own override — a manual edit
  // should never get silently clobbered by, say, dragging a fixture.
  useEffect(() => {
    if (!promptEdited) setPromptDraft(autoPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt, promptEdited]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  function handleFileChange(file: File | null) {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  }

  function handleRoomSelect(roomId: string) {
    setSelectedRoomId(roomId);
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    setRoomType(matchRoomType(room.type));
    setWidth(room.width);
    setDepth(room.depth);
  }

  async function handleSuggestLayout() {
    if (planPages.length === 0) {
      notify("error", "Upload plan pages on the Plan tab first (marked as layout pages).");
      return;
    }
    if (!hasRoomDims) {
      notify("error", "Enter room dimensions first.");
      return;
    }
    const room = roomSource === "existing" ? rooms.find((r) => r.id === selectedRoomId) : null;
    const catalog = getFixturesForRoomType(roomType);

    setSuggesting(true);
    try {
      await run(suggestTaskKey, `Reading plans for ${roomType.toLowerCase()} layout…`, async () => {
        const res = await fetchWithRetry("/api/claude/suggest-room-layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pages: planPages.map((p) => ({ label: p.label, url: p.storage_url })),
            roomName: room?.name ?? null,
            roomType,
            roomWidth: numWidth,
            roomDepth: numDepth,
            fixtures: catalog.map((f) => ({ id: f.id, label: f.label, width: f.width, depth: f.depth })),
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Layout suggestion failed.");

        const catalogById = new Map(catalog.map((f) => [f.id, f]));
        const suggested: PlacedFixture[] = (json.items ?? [])
          .map((it: { typeId: string; x: number; y: number; rotated: boolean }) => {
            const f = catalogById.get(it.typeId);
            if (!f) return null;
            return {
              id: crypto.randomUUID(),
              typeId: f.id,
              label: f.label,
              x: it.x,
              y: it.y,
              width: f.width,
              depth: f.depth,
              rotated: !!it.rotated,
            };
          })
          .filter((it: PlacedFixture | null): it is PlacedFixture => it !== null);

        if (suggested.length === 0) {
          notify("error", "Couldn't come up with a layout for this room — try placing fixtures manually.");
          return;
        }

        setLayout(clampItemsToArea(suggested, numWidth, numDepth));
        notify(
          "success",
          json.found_on_plan
            ? "Example layout placed from the plans — drag to adjust."
            : `Example layout placed (not matched on the plans — a typical arrangement instead).${json.notes ? ` ${json.notes}` : ""}`
        );
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Layout suggestion failed.");
    } finally {
      setSuggesting(false);
    }
  }

  async function uploadToStorage(blob: Blob, ext: string, suffix: string): Promise<string> {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");

    const path = `${user.id}/${projectId}/${Date.now()}-${suffix}.${ext}`;
    const { error } = await supabase.storage.from("interior-design-photos").upload(path, blob, {
      contentType: blob.type,
    });
    if (error) throw new Error(error.message);

    const { data: pub, error: pubSignError } = await supabase.storage
      .from("interior-design-photos")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (pubSignError || !pub) throw new Error(pubSignError?.message ?? "Could not get a URL for the uploaded file.");
    return pub.signedUrl;
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!style.trim()) {
      notify("error", "Enter a style.");
      return;
    }

    const w = width;
    const d = depth;
    const s = sqft ? Number(sqft) : null;
    const roomId = roomSource === "existing" && selectedRoomId ? selectedRoomId : null;
    const selectedRoom = roomId ? (rooms.find((r) => r.id === roomId) ?? null) : null;
    const prompt = promptDraft.trim() || autoPrompt;

    setSubmitting(true);
    try {
      await run(taskKey, `Designing ${roomType.toLowerCase()} — ${style}…`, async () => {
        const originalUrl = photoFile
          ? await uploadToStorage(photoFile, photoFile.name.split(".").pop() || "jpg", "original")
          : null;

        // No uploaded photo to anchor on — the layout list above already
        // tells the model where fixtures go, but not what the room's real
        // walls/windows/doors look like. When this design is tied to an
        // actual tracked room and its construction has Plan tab layout
        // sheets, attach those directly instead of generating a
        // disconnected room from text alone (same grounding as the Rooms
        // tab's "Generate image (AI)" — see RenderingPanel).
        const res = originalUrl
          ? await fetchWithRetry("/api/gemini/edit-room-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageUrl: originalUrl, prompt }),
            })
          : await fetchWithRetry("/api/gemini/generate-room-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                selectedRoom && planPages.length > 0
                  ? { prompt, planImageUrls: planPages.map((p) => p.storage_url), roomName: selectedRoom.name }
                  : { prompt }
              ),
            });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Design generation failed.");

        const byteChars = atob(json.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: json.mimeType ?? "image/png" });
        const generatedUrl = await uploadToStorage(blob, "png", "design");

        const saveRes = await saveInteriorDesign(projectId, {
          roomId,
          roomType,
          style: style.trim(),
          width: w,
          depth: d,
          sqft: s,
          layout,
          originalPhotoUrl: originalUrl,
          generatedImageUrl: generatedUrl,
          prompt,
        });
        if (!saveRes.ok || !saveRes.id) throw new Error(saveRes.error ?? "Could not save design.");

        setDesigns((prev) => [
          {
            id: saveRes.id!,
            project_id: projectId,
            room_id: roomId,
            room_type: roomType,
            style: style.trim(),
            width: w,
            depth: d,
            sqft: s,
            layout,
            original_photo_url: originalUrl,
            generated_image_url: generatedUrl,
            prompt,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        notify("success", "Room designed.");
        handleFileChange(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setPromptEdited(false);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Design generation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddToImage(design: InteriorDesign) {
    if (!addToImageText.trim()) return;
    setAddingToImage(design.id);
    const taskKey2 = `interior-design-add:${design.id}`;
    try {
      await run(taskKey2, `Adding to "${design.room_type} — ${design.style}" image…`, async () => {
        const res = await fetchWithRetry("/api/gemini/edit-room-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: design.generated_image_url, prompt: addToImageText.trim() }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Image edit failed.");

        const byteChars = atob(json.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: json.mimeType ?? "image/png" });
        const newUrl = await uploadToStorage(blob, "png", "design");

        const updateRes = await updateInteriorDesignImage(projectId, design.id, {
          roomType: design.room_type,
          style: design.style,
          generatedImageUrl: newUrl,
          prompt: addToImageText.trim(),
        });
        if (!updateRes.ok) throw new Error(updateRes.error ?? "Could not save the updated image.");

        setDesigns((prev) =>
          prev.map((d) => (d.id === design.id ? { ...d, generated_image_url: newUrl, prompt: addToImageText.trim() } : d))
        );
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

  return (
    <div className="space-y-8">
      <div className="card p-4">
        <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">Design a room</h2>
        <p className="mb-4 text-xs text-blueprint/50">
          Optionally upload a photo of an empty or framed-out room — Gemini will redesign that actual photo, same
          architecture and layout. Without a photo, it generates a new room from scratch using the style, room
          type, and the layout you lay out below.
        </p>

        <form onSubmit={handleGenerate} className="space-y-4">
          <div>
            <label className="label">Room photo (optional)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="input"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            {photoPreview && (
              <div className="relative mt-2 aspect-[4/3] w-full max-w-xs overflow-hidden rounded-lg bg-concrete">
                <Image src={photoPreview} alt="Room preview" fill className="object-cover" unoptimized />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Room type</label>
              <select className="input" value={roomType} onChange={(e) => setRoomType(e.target.value as RoomTypeOption)}>
                {ROOM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Style</label>
              <input className="input" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. Modern Farmhouse" />
            </div>
          </div>

          <div>
            <label className="label">Room sizing</label>
            <div className="mb-2 flex gap-4 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={roomSource === "existing"}
                  disabled={rooms.length === 0}
                  onChange={() => setRoomSource("existing")}
                />
                Use an existing room{rooms.length === 0 && " (none added yet)"}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={roomSource === "manual"} onChange={() => setRoomSource("manual")} />
                Enter manually
              </label>
            </div>

            {roomSource === "existing" && rooms.length > 0 ? (
              <select className="input" value={selectedRoomId} onChange={(e) => handleRoomSelect(e.target.value)}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.width && r.depth ? ` (${formatFeetInches(r.width)} × ${formatFeetInches(r.depth)})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <FeetInchesInput value={width} onChange={setWidth} label="Width" />
                <FeetInchesInput value={depth} onChange={setDepth} label="Depth" />
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="input"
                  placeholder="Sqft"
                  value={sqft}
                  onChange={(e) => setSqft(stripLeadingZero(e.target.value))}
                  onFocus={(e) => e.target.select()}
                />
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="label mb-0">Room layout (optional)</label>
              {hasRoomDims && (
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-xs"
                  disabled={suggestingLayout || planPages.length === 0}
                  onClick={handleSuggestLayout}
                  title={planPages.length === 0 ? "Upload plan pages on the Plan tab first" : undefined}
                >
                  {suggestingLayout ? "Reading plans…" : "Example setup from plans"}
                </button>
              )}
            </div>
            {hasRoomDims ? (
              <LayoutEditor
                catalog={getFixturesForRoomType(roomType)}
                areaWidth={numWidth}
                areaDepth={numDepth}
                items={layout}
                onChange={setLayout}
              />
            ) : (
              <p className="text-xs text-blueprint/40">Enter room dimensions above to lay out fixtures and furniture.</p>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="label mb-0">Image prompt — edit before generating, or write your own</label>
              {promptEdited && (
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-xs"
                  onClick={() => setPromptEdited(false)}
                >
                  Reset to auto-generated
                </button>
              )}
            </div>
            <textarea
              className="input font-mono text-xs"
              rows={5}
              value={promptDraft}
              onChange={(e) => {
                setPromptDraft(e.target.value);
                setPromptEdited(true);
              }}
            />
          </div>

          <button type="submit" className="btn-amber w-full" disabled={generating}>
            {generating ? "Designing…" : "Design this room"}
          </button>
        </form>
      </div>

      {designs.length === 0 ? (
        <p className="text-sm text-blueprint/50">No designs yet — fill in the form above to get started.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {designs.map((d, i) => (
            <div
              key={d.id}
              className="card-hover animate-fade-in-up rounded-lg border border-blueprint/10 p-3"
              style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
            >
              <div className="relative mb-2 aspect-[4/3] overflow-hidden rounded-md bg-concrete">
                <Image src={d.generated_image_url} alt={`${d.room_type} — ${d.style}`} fill className="object-cover" unoptimized />
              </div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-blueprint-dark">
                  {d.room_type} — {d.style}
                </span>
                <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(d.id)}>
                  Delete
                </button>
              </div>
              {(d.width || d.sqft) && (
                <p className="mb-2 text-xs text-blueprint/50">
                  {d.width && d.depth ? `${formatFeetInches(d.width)} × ${formatFeetInches(d.depth)} — ` : ""}
                  {d.sqft ? `${d.sqft} sqft` : ""}
                  {d.layout.length > 0 ? ` — ${d.layout.length} fixture${d.layout.length === 1 ? "" : "s"} laid out` : ""}
                </p>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-amber-dark">{d.original_photo_url ? "Before photo & prompt" : "Prompt"}</summary>
                {d.original_photo_url && (
                  <div className="relative mt-1 aspect-[4/3] overflow-hidden rounded-md bg-concrete">
                    <Image src={d.original_photo_url} alt="Before" fill className="object-cover" unoptimized />
                  </div>
                )}
                <p className="mt-1 whitespace-pre-wrap rounded bg-concrete p-2 text-blueprint/70">{d.prompt}</p>
                <button className="btn-ghost mt-1 text-xs" onClick={() => handleCopyPrompt(d.prompt)}>
                  Copy prompt
                </button>
              </details>
              <div className="mt-2 flex gap-2">
                <button
                  className="btn-ghost flex-1 text-xs"
                  onClick={() => handleSaveImage(d.generated_image_url, `${d.room_type}-${d.style}`)}
                >
                  Save image
                </button>
                <button
                  className="btn-outline flex-1 text-xs"
                  onClick={() => setAddToImagePromptFor(addToImagePromptFor === d.id ? null : d.id)}
                >
                  Add to this image
                </button>
              </div>
              {addToImagePromptFor === d.id && (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    className="input text-xs"
                    rows={3}
                    placeholder='Describe what to add or change — e.g. "add a potted plant in the corner, and a rug under the coffee table"'
                    value={addToImageText}
                    onChange={(e) => setAddToImageText(e.target.value)}
                  />
                  <button
                    className="btn-amber w-full text-xs"
                    disabled={!addToImageText.trim() || addingToImage === d.id}
                    onClick={() => handleAddToImage(d)}
                  >
                    {addingToImage === d.id ? "Updating…" : "Update image"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete this design?"
        message="The generated design (and before photo, if any) will be permanently removed."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteInteriorDesign(projectId, deleting);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete design.");
          } else {
            setDesigns((prev) => prev.filter((d) => d.id !== deleting));
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}
