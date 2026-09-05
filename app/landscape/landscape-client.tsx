"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { LANDSCAPE_COMPONENTS, LANDSCAPE_STYLES, buildLandscapePrompt } from "@/lib/landscapePrompt";
import { saveLandscapeDesign, deleteLandscapeDesign } from "@/app/landscape/actions";
import type { LandscapeComponentSelection, LandscapeDesign } from "@/lib/types";

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

  const [style, setStyle] = useState<string>(LANDSCAPE_STYLES[0]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

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

  function toggleComponent(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

    const { data: pub } = supabase.storage.from("landscape-photos").getPublicUrl(path);
    return pub.publicUrl;
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!photoFile) {
      notify("error", "Upload a photo of the house's exterior first.");
      return;
    }
    if (selectedIds.size === 0 && !notes.trim()) {
      notify("error", "Pick at least one landscape component, or describe what to add in the notes.");
      return;
    }

    const components: LandscapeComponentSelection[] = LANDSCAPE_COMPONENTS.filter((c) => selectedIds.has(c.id)).map((c) => ({
      id: c.id,
      label: c.label,
      detail: details[c.id] ?? "",
    }));

    setSubmitting(true);
    try {
      await run(taskKey, `Designing landscape — ${style}…`, async () => {
        const originalUrl = await uploadToStorage(photoFile, photoFile.name.split(".").pop() || "jpg", "original");
        const prompt = buildLandscapePrompt({ style, components, notes });

        // Always an image edit (never a from-scratch generation) — the
        // whole point of Landscape is redesigning this exact house's yard,
        // so a photo is required upstream rather than optional.
        const res = await fetchWithRetry("/api/openai/edit-room-image", {
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
          style,
          components,
          notes: notes.trim() || null,
          originalPhotoUrl: originalUrl,
          generatedImageUrl: generatedUrl,
          prompt,
        });
        if (!saveRes.ok || !saveRes.id) throw new Error(saveRes.error ?? "Could not save design.");

        setDesigns((prev) => [
          {
            id: saveRes.id!,
            project_id: projectId,
            style,
            components,
            notes: notes.trim() || null,
            original_photo_url: originalUrl,
            generated_image_url: generatedUrl,
            prompt,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        notify("success", "Landscape designed.");
        handleFileChange(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setSelectedIds(new Set());
        setDetails({});
        setNotes("");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Landscape generation failed.");
    } finally {
      setSubmitting(false);
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
          Upload a photo of the house from the outside — OpenAI redesigns that actual photo&apos;s yard, keeping the
          house itself unchanged. Pick which components to add below, then generate.
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
            <div className="mt-1.5 flex flex-wrap gap-1">
              {LANDSCAPE_STYLES.map((s) => (
                <button key={s} type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setStyle(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Components to add</label>
            <div className="space-y-2">
              {LANDSCAPE_COMPONENTS.map((c) => {
                const checked = selectedIds.has(c.id);
                return (
                  <div key={c.id} className="rounded-lg border border-blueprint/10 p-2.5">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={checked} onChange={() => toggleComponent(c.id)} />
                      <span className="font-medium text-blueprint-dark">{c.label}</span>
                    </label>
                    {checked && (
                      <input
                        className="input mt-2 text-xs"
                        placeholder={`Optional details — e.g. size, placement, material…`}
                        value={details[c.id] ?? ""}
                        onChange={(e) => setDetails((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                    )}
                  </div>
                );
              })}
            </div>
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

          <button type="submit" className="btn-amber w-full" disabled={generating}>
            {generating ? "Designing…" : "Design this landscape"}
          </button>
        </form>
      </div>

      {designs.length === 0 ? (
        <p className="text-sm text-blueprint/50">No landscape designs yet — fill in the form above to get started.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {designs.map((d) => (
            <div key={d.id} className="rounded-lg border border-blueprint/10 p-3">
              <div className="relative mb-2 aspect-[4/3] overflow-hidden rounded-md bg-concrete">
                <Image src={d.generated_image_url} alt={d.style} fill className="object-cover" unoptimized />
              </div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-blueprint-dark">{d.style}</span>
                <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(d.id)}>
                  Delete
                </button>
              </div>
              {d.components.length > 0 && (
                <p className="mb-2 text-xs text-blueprint/50">{d.components.map((c) => c.label).join(", ")}</p>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-amber-dark">Before photo &amp; prompt</summary>
                <div className="relative mt-1 aspect-[4/3] overflow-hidden rounded-md bg-concrete">
                  <Image src={d.original_photo_url} alt="Before" fill className="object-cover" unoptimized />
                </div>
                <p className="mt-1 whitespace-pre-wrap rounded bg-concrete p-2 text-blueprint/70">{d.prompt}</p>
                <button className="btn-ghost mt-1 text-xs" onClick={() => handleCopyPrompt(d.prompt)}>
                  Copy prompt
                </button>
              </details>
              <button className="btn-ghost mt-2 w-full text-xs" onClick={() => handleSaveImage(d.generated_image_url, `landscape-${d.style}`)}>
                Save image
              </button>
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
