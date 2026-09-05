"use client";

import { useState } from "react";
import Image from "next/image";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import type { Subcontractor } from "@/lib/types";

interface PlanPage {
  id: string;
  storage_url: string;
  label: string;
}

interface RoomImage {
  id: string;
  roomName: string;
  style: string;
  uploaded_photo_url: string;
}

interface InteriorDesignRow {
  id: string;
  room_type: string;
  style: string;
  generated_image_url: string;
}

interface LandscapeRow {
  id: string;
  style: string;
  generated_image_url: string;
}

function useToggleSet(initial: string[]) {
  const [set, setSet] = useState<Set<string>>(new Set(initial));
  function toggle(id: string) {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function setAll(ids: string[], checked: boolean) {
    setSet(checked ? new Set(ids) : new Set());
  }
  return { set, toggle, setAll };
}

export function HouseBookClient({
  projectId,
  projectName,
  projectAddress,
  planPages,
  roomImages,
  interiorDesigns,
  landscapeDesigns,
  subcontractors,
}: {
  projectId: string;
  projectName: string;
  projectAddress: string | null;
  planPages: PlanPage[];
  roomImages: RoomImage[];
  interiorDesigns: InteriorDesignRow[];
  landscapeDesigns: LandscapeRow[];
  subcontractors: Subcontractor[];
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const taskKey = `house-book:${projectId}`;
  const [generating, setGenerating] = useState(false);

  // Everything starts checked — a Developer picking a subset is the
  // exception, not the common case; deselecting is one click either way.
  const plans = useToggleSet(planPages.map((p) => p.id));
  const roomPhotos = useToggleSet(roomImages.map((r) => r.id));
  const designs = useToggleSet(interiorDesigns.map((d) => d.id));
  const landscape = useToggleSet(landscapeDesigns.map((l) => l.id));
  const subs = useToggleSet(subcontractors.map((s) => s.id));
  const [includeClosingNote, setIncludeClosingNote] = useState(true);

  const hasAnyContent =
    plans.set.size > 0 || roomPhotos.set.size > 0 || designs.set.size > 0 || landscape.set.size > 0 || subs.set.size > 0 || includeClosingNote;

  async function handleGenerate() {
    setGenerating(true);
    try {
      await run(taskKey, "Putting together the House Book…", async () => {
        const res = await fetchWithRetry(`/api/projects/${projectId}/house-book`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planPageIds: Array.from(plans.set),
            roomImageIds: Array.from(roomPhotos.set),
            interiorDesignIds: Array.from(designs.set),
            landscapeIds: Array.from(landscape.set),
            subcontractorIds: Array.from(subs.set),
            includeClosingNote,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Could not generate the House Book.");
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${projectName.replace(/[^a-z0-9]+/gi, "-")}-house-book.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        notify("success", "House Book generated.");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not generate the House Book.");
    } finally {
      setGenerating(false);
    }
  }

  const working = generating || isRunning(taskKey);

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">House Book</h2>
        <p className="text-xs text-blueprint/50">
          A polished, book-style PDF for the homeowner — layout plans, room and finish photos, the landscape design,
          your team, and a closing note about the house. Pick what to include, then generate.
        </p>
      </div>

      {planPages.length > 0 && (
        <Section title="Plans & Layout" count={plans.set.size} total={planPages.length} onSetAll={(c) => plans.setAll(planPages.map((p) => p.id), c)}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {planPages.map((p) => (
              <ImageCheckCard key={p.id} src={p.storage_url} label={p.label} checked={plans.set.has(p.id)} onToggle={() => plans.toggle(p.id)} />
            ))}
          </div>
        </Section>
      )}

      {(roomImages.length > 0 || interiorDesigns.length > 0) && (
        <Section
          title="Room & Finish Images"
          count={roomPhotos.set.size + designs.set.size}
          total={roomImages.length + interiorDesigns.length}
          onSetAll={(c) => {
            roomPhotos.setAll(roomImages.map((r) => r.id), c);
            designs.setAll(interiorDesigns.map((d) => d.id), c);
          }}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {roomImages.map((r) => (
              <ImageCheckCard
                key={r.id}
                src={r.uploaded_photo_url}
                label={`${r.roomName} — ${r.style}`}
                checked={roomPhotos.set.has(r.id)}
                onToggle={() => roomPhotos.toggle(r.id)}
              />
            ))}
            {interiorDesigns.map((d) => (
              <ImageCheckCard
                key={d.id}
                src={d.generated_image_url}
                label={`${d.room_type} — ${d.style}`}
                checked={designs.set.has(d.id)}
                onToggle={() => designs.toggle(d.id)}
              />
            ))}
          </div>
        </Section>
      )}

      {landscapeDesigns.length > 0 && (
        <Section
          title="Landscape"
          count={landscape.set.size}
          total={landscapeDesigns.length}
          onSetAll={(c) => landscape.setAll(landscapeDesigns.map((l) => l.id), c)}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {landscapeDesigns.map((l) => (
              <ImageCheckCard
                key={l.id}
                src={l.generated_image_url}
                label={l.style}
                checked={landscape.set.has(l.id)}
                onToggle={() => landscape.toggle(l.id)}
              />
            ))}
          </div>
        </Section>
      )}

      {subcontractors.length > 0 && (
        <Section title="Your Team" count={subs.set.size} total={subcontractors.length} onSetAll={(c) => subs.setAll(subcontractors.map((s) => s.id), c)}>
          <div className="space-y-1.5">
            {subcontractors.map((s) => (
              <label key={s.id} className="flex items-center gap-2.5 rounded-lg border border-blueprint/10 p-2 text-sm">
                <input type="checkbox" checked={subs.set.has(s.id)} onChange={() => subs.toggle(s.id)} />
                <span className="flex-1">
                  <span className="font-medium text-blueprint-dark">{s.company_name}</span>
                  {s.trade && <span className="ml-2 text-xs text-blueprint/50">{s.trade}</span>}
                </span>
              </label>
            ))}
          </div>
        </Section>
      )}

      <div className="card p-4">
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={includeClosingNote} onChange={(e) => setIncludeClosingNote(e.target.checked)} />
          <span className="font-medium text-blueprint-dark">Include a closing note about the house</span>
        </label>
        <p className="mt-1 pl-6 text-xs text-blueprint/50">
          A short, warm closing page written by Claude, grounded in what&apos;s selected above — the construction&apos;s
          address, style, and finishes.
        </p>
      </div>

      <button className="btn-amber w-full" onClick={handleGenerate} disabled={working || !hasAnyContent}>
        {working ? "Generating…" : "Generate House Book"}
      </button>

      {planPages.length === 0 && roomImages.length === 0 && interiorDesigns.length === 0 && landscapeDesigns.length === 0 && subcontractors.length === 0 && (
        <p className="text-center text-xs text-blueprint/40">
          {projectAddress ? `${projectName} — ${projectAddress}. ` : ""}
          Nothing to include yet — add layout pages, room renderings, or a landscape design elsewhere first, or just
          generate a closing note on its own above.
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  total,
  onSetAll,
  children,
}: {
  title: string;
  count: number;
  total: number;
  onSetAll: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-blueprint-dark">
          {title} <span className="font-normal text-blueprint/40">({count}/{total})</span>
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <button className="font-medium text-amber-dark hover:underline" onClick={() => onSetAll(true)}>
            Select all
          </button>
          <button className="font-medium text-amber-dark hover:underline" onClick={() => onSetAll(false)}>
            Select none
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function ImageCheckCard({ src, label, checked, onToggle }: { src: string; label: string; checked: boolean; onToggle: () => void }) {
  return (
    <label
      className={`block cursor-pointer overflow-hidden rounded-lg border-2 transition-colors ${
        checked ? "border-amber" : "border-transparent"
      }`}
    >
      <div className="relative aspect-[4/3] bg-concrete">
        <Image src={src} alt={label} fill className="object-cover" unoptimized />
        <input type="checkbox" className="absolute right-2 top-2 h-4 w-4" checked={checked} onChange={onToggle} />
      </div>
      <p className="truncate bg-white px-2 py-1 text-xs text-blueprint/70">{label}</p>
    </label>
  );
}
