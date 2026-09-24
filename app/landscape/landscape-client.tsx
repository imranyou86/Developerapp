"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { buildLandscapePrompt } from "@/lib/landscapePrompt";
import { describeLayout } from "@/lib/layoutDescription";
import { LayoutEditor, clampItemsToArea } from "@/components/LayoutEditor";
import { LANDSCAPE_CATALOG } from "@/lib/landscapeCatalog";
import { FeetInchesInput } from "@/components/FeetInchesInput";
import { formatFeetInches } from "@/lib/feetInches";
import { saveLandscapeDesign, deleteLandscapeDesign, updateLandscapeDesignImage } from "@/app/landscape/actions";
import type { LandscapeDesign, PlacedFixture } from "@/lib/types";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";

export function LandscapeClient({ projectId, initialDesigns }: { projectId: string | null; initialDesigns: LandscapeDesign[] }) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const taskKey = `landscape:${projectId ?? "standalone"}`;

  const [designs, setDesigns] = useState<LandscapeDesign[]>(initialDesigns);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const generating = submitting || isRunning(taskKey);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [style, setStyle] = useState<string>("");
  const [yardWidth, setYardWidth] = useState<number | null>(null);
  const [yardDepth, setYardDepth] = useState<number | null>(null);
  const [layout, setLayout] = useState<PlacedFixture[]>([]);
  const [notes, setNotes] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [promptEdited, setPromptEdited] = useState(false);

  const [addToImagePromptFor, setAddToImagePromptFor] = useState<string | null>(null);
  const [addToImageText, setAddToImageText] = useState("");
  const [addingToImage, setAddingToImage] = useState<string | null>(null);

  const hasYardDims = yardWidth != null && yardDepth != null && yardWidth > 0 && yardDepth > 0;
  const numYardWidth = yardWidth ?? 0;
  const numYardDepth = yardDepth ?? 0;
  const layoutDescription = hasYardDims
    ? describeLayout(layout, numYardWidth, numYardDepth, { sideLabel: "side", elementNoun: "landscape elements" })
    : "";
  const autoPrompt = buildLandscapePrompt({ style: style.trim() || "unspecified", layoutDescription, notes });

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  // Keep placed items inside the yard whenever its dimensions change.
  useEffect(() => {
    if (hasYardDims) setLayout((prev) => clampItemsToArea(prev, numYardWidth, numYardDepth));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numYardWidth, numYardDepth]);

  // Tracks the auto-composed prompt live as the form changes, unless the
  // user has typed their own override.
  useEffect(() => {
    if (!promptEdited) setPromptDraft(autoPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt, promptEdited]);

  function handleFileChange(file: File | null) {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  }

  async function uploadToStorage(blob: Blob, ext: string, suffix: string): Promise<string> {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");

    const path = projectId ? `${user.id}/${projectId}/${Date.now()}-${suffix}.${ext}` : `${user.id}/standalone/${Date.now()}-${suffix}.${ext}`;
    const { error } = await supabase.storage.from("landscape-photos").upload(path, blob, {
      contentType: blob.type,
    });
    if (error) throw new Error(error.message);

    const { data: pub, error: pubSignError } = await supabase.storage
      .from("landscape-photos")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (pubSignError || !pub) throw new Error(pubSignError?.message ?? "Could not get a URL for the uploaded file.");
    return pub.signedUrl;
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!photoFile) {
      notify("error", "Upload a photo of the house's exterior first.");
      return;
    }
    if (!style.trim()) {
      notify("error", "Enter a style.");
      return;
    }

    const prompt = promptDraft.trim() || autoPrompt;
    const w = yardWidth;
    const d = yardDepth;

    setSubmitting(true);
    try {
      await run(taskKey, `Designing landscape — ${style}…`, async () => {
        const originalUrl = await uploadToStorage(photoFile, photoFile.name.split(".").pop() || "jpg", "original");

        // Always an image edit (never a from-scratch generation) — the
        // whole point of Landscape is redesigning this exact house's yard,
        // so a photo is required upstream rather than optional.
        const res = await fetchWithRetry("/api/gemini/edit-room-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: originalUrl, prompt }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Landscape generation failed.");

        const byteChars = atob(json.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: json.mimeType ?? "image/png" });
        const generatedUrl = await uploadToStorage(blob, "png", "design");

        const saveRes = await saveLandscapeDesign(projectId, {
          style: style.trim(),
          notes: notes.trim() || null,
          originalPhotoUrl: originalUrl,
          generatedImageUrl: generatedUrl,
          prompt,
          layout,
          yardWidth: w,
          yardDepth: d,
        });
        if (!saveRes.ok || !saveRes.id) throw new Error(saveRes.error ?? "Could not save design.");

        setDesigns((prev) => [
          {
            id: saveRes.id!,
            project_id: projectId,
            style: style.trim(),
            components: [],
            notes: notes.trim() || null,
            original_photo_url: originalUrl,
            generated_image_url: generatedUrl,
            prompt,
            layout,
            yard_width: w,
            yard_depth: d,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        notify("success", "Landscape designed.");
        handleFileChange(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setNotes("");
        setPromptEdited(false);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Landscape generation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddToImage(design: LandscapeDesign) {
    if (!addToImageText.trim()) return;
    setAddingToImage(design.id);
    const taskKey2 = `landscape-add:${design.id}`;
    try {
      await run(taskKey2, `Adding to "${design.style}" landscape image…`, async () => {
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

        // Append rather than overwrite — the stored prompt should keep
        // describing everything actually in the image, not just the most
        // recent edit, so "Copy prompt" and any future regeneration still
        // reflect the full picture.
        const updatedPrompt = `${design.prompt}\n\nUpdate: ${addToImageText.trim()}`;

        const updateRes = await updateLandscapeDesignImage(projectId, design.id, {
          style: design.style,
          generatedImageUrl: newUrl,
          prompt: updatedPrompt,
        });
        if (!updateRes.ok) throw new Error(updateRes.error ?? "Could not save the updated image.");

        setDesigns((prev) =>
          prev.map((d) => (d.id === design.id ? { ...d, generated_image_url: newUrl, prompt: updatedPrompt } : d))
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
        <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">Design the landscape</h2>
        <p className="mb-4 text-xs text-blueprint/50">
          Upload a photo of the house from the outside — Gemini redesigns that actual photo&apos;s yard, keeping the
          house itself unchanged. Optionally lay out yard elements below, then generate.
        </p>

        <form onSubmit={handleGenerate} className="space-y-4">
          <div>
            <label className="label">House photo (required)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="input"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            {photoPreview && (
              <div className="relative mt-2 aspect-[4/3] w-full max-w-xs overflow-hidden rounded-lg bg-concrete">
                <Image src={photoPreview} alt="House preview" fill className="object-cover" unoptimized />
              </div>
            )}
          </div>

          <div>
            <label className="label">Style</label>
            <input className="input" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. Modern Minimalist" />
          </div>

          <div>
            <label className="label">Yard sizing (optional, for the layout editor)</label>
            <div className="grid grid-cols-2 gap-2">
              <FeetInchesInput value={yardWidth} onChange={setYardWidth} label="Width" />
              <FeetInchesInput value={yardDepth} onChange={setYardDepth} label="Depth" />
            </div>
          </div>

          <div>
            <label className="label">Yard layout (optional)</label>
            {hasYardDims ? (
              <LayoutEditor
                catalog={LANDSCAPE_CATALOG}
                areaWidth={numYardWidth}
                areaDepth={numYardDepth}
                areaNoun="yard"
                items={layout}
                onChange={setLayout}
              />
            ) : (
              <p className="text-xs text-blueprint/40">Enter yard dimensions above to lay out elements like a pool, deck, or patio.</p>
            )}
          </div>

          <div>
            <label className="label">Additional notes (optional)</label>
            <textarea
              className="input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else to add — fencing, lighting, pavers, plantings…"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="label mb-0">Image prompt — edit before generating, or write your own</label>
              {promptEdited && (
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setPromptEdited(false)}>
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
            {generating ? "Designing…" : "Design this landscape"}
          </button>
        </form>
      </div>

      {designs.length === 0 ? (
        <p className="text-sm text-blueprint/50">No landscape designs yet — fill in the form above to get started.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {designs.map((d, i) => (
            <div
              key={d.id}
              className="card-hover animate-fade-in-up rounded-lg border border-blueprint/10 p-3"
              style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
            >
              <div className="relative mb-2 aspect-[4/3] overflow-hidden rounded-md bg-concrete">
                <Image src={d.generated_image_url} alt={d.style} fill className="object-cover" unoptimized />
              </div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-blueprint-dark">{d.style}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-amber-dark hover:underline"
                    onClick={() => handleCopyPrompt(d.prompt)}
                    title="Copy the prompt without opening the details below"
                  >
                    Copy prompt
                  </button>
                  <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(d.id)}>
                    Delete
                  </button>
                </div>
              </div>
              {(d.yard_width || d.layout.length > 0) && (
                <p className="mb-2 text-xs text-blueprint/50">
                  {d.yard_width && d.yard_depth ? `${formatFeetInches(d.yard_width)} × ${formatFeetInches(d.yard_depth)} — ` : ""}
                  {d.layout.length > 0 ? `${d.layout.length} element${d.layout.length === 1 ? "" : "s"} laid out` : ""}
                </p>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-amber-dark">Before photo &amp; prompt</summary>
                <div className="relative mt-1 aspect-[4/3] overflow-hidden rounded-md bg-concrete">
                  <Image src={d.original_photo_url} alt="Before" fill className="object-cover" unoptimized />
                </div>
                <p className="mt-1 whitespace-pre-wrap rounded bg-concrete p-2 text-blueprint/70">{d.prompt}</p>
              </details>
              <div className="mt-2 flex gap-2">
                <button className="btn-ghost flex-1 text-xs" onClick={() => handleSaveImage(d.generated_image_url, `landscape-${d.style}`)}>
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
                    placeholder='Describe what to add or change — e.g. "add string lights over the patio, and a row of potted plants along the fence"'
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
        message="The generated design and before photo will be permanently removed."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteLandscapeDesign(projectId, deleting);
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
