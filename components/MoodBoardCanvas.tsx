"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BOARD_ASPECT, assignDefaultPositions, clamp } from "@/lib/moodBoardLayout";
import type { MoodBoardItem } from "@/lib/types";

const MIN_SIZE = 0.05;

type DragMode = { kind: "move"; id: string; grabDx: number; grabDy: number } | { kind: "resize"; id: string };

// Full-bleed overlay (same pattern as PlanAreaPicker/FileViewerModal) — a
// freeform drag-and-resize canvas for a mood board's items needs to show at
// near-full size, not fit inside the shared Modal's small padded card.
export function MoodBoardCanvas({
  roomName,
  items,
  onChange,
  onClose,
  onGenerate,
  generating,
  collageImageUrl,
  onDownload,
}: {
  roomName: string;
  items: MoodBoardItem[];
  onChange: (items: MoodBoardItem[]) => void;
  onClose: () => void;
  onGenerate: () => void;
  generating: boolean;
  collageImageUrl: string | null;
  onDownload: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Seed any never-positioned items with a default grid layout the moment
  // the canvas opens, so dragging starts from something sensible instead
  // of everything stacked at the origin — same math the generator itself
  // falls back to, so this never visually jumps once a collage exists.
  const [localItems, setLocalItems] = useState<MoodBoardItem[]>(() => assignDefaultPositions(items));
  const itemsRef = useRef(localItems);
  const dragRef = useRef<DragMode | null>(null);

  useEffect(() => {
    itemsRef.current = localItems;
  }, [localItems]);

  function fractionAt(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      fx: clamp((clientX - rect.left) / rect.width, 0, 1),
      fy: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function handleMove(e: PointerEvent) {
    const mode = dragRef.current;
    if (!mode) return;
    const { fx, fy } = fractionAt(e.clientX, e.clientY);
    setLocalItems((prev) =>
      prev.map((it) => {
        if (it.id !== mode.id) return it;
        const w = it.width ?? 0.2;
        const h = it.height ?? 0.2;
        if (mode.kind === "move") {
          const x = clamp(fx - mode.grabDx, 0, 1 - w);
          const y = clamp(fy - mode.grabDy, 0, 1 - h);
          return { ...it, x, y };
        }
        const x = it.x ?? 0;
        const y = it.y ?? 0;
        const width = clamp(fx - x, MIN_SIZE, 1 - x);
        const height = clamp(fy - y, MIN_SIZE, 1 - y);
        return { ...it, width, height };
      })
    );
  }

  function endDrag() {
    dragRef.current = null;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", endDrag);
    // Persisted once, at drag end — not on every intermediate move, so
    // dragging doesn't fire a server action per pixel.
    onChange(itemsRef.current);
  }

  function startDrag(mode: DragMode) {
    dragRef.current = mode;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", endDrag);
  }

  function handleItemPointerDown(e: React.PointerEvent, item: MoodBoardItem) {
    e.stopPropagation();
    e.preventDefault();
    const { fx, fy } = fractionAt(e.clientX, e.clientY);
    startDrag({ kind: "move", id: item.id, grabDx: fx - (item.x ?? 0), grabDy: fy - (item.y ?? 0) });
  }

  function handleResizePointerDown(e: React.PointerEvent, item: MoodBoardItem) {
    e.stopPropagation();
    e.preventDefault();
    startDrag({ kind: "resize", id: item.id });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-blueprint-dark/70 p-4 animate-fade-in">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-elevated animate-scale-in">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-blueprint/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-blueprint-dark">Arrange — {roomName}</h2>
            <p className="text-xs text-blueprint/50">Drag items to move them, or their corner handle to resize.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-blueprint/50 transition-colors hover:bg-concrete hover:text-blueprint"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-concrete/40 p-4">
          <div
            ref={containerRef}
            className="relative w-full max-w-3xl select-none rounded-md border border-blueprint/10 bg-white shadow-soft"
            style={{ aspectRatio: BOARD_ASPECT, touchAction: "none" }}
          >
            {localItems.map((it) => (
              <div
                key={it.id}
                className={`group absolute cursor-move overflow-hidden rounded border-2 ${
                  it.type === "material" ? "border-amber" : "border-blueprint"
                }`}
                style={{
                  left: `${(it.x ?? 0) * 100}%`,
                  top: `${(it.y ?? 0) * 100}%`,
                  width: `${(it.width ?? 0.2) * 100}%`,
                  height: `${(it.height ?? 0.2) * 100}%`,
                  touchAction: "none",
                }}
                onPointerDown={(e) => handleItemPointerDown(e, it)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL, not a next/image remote source */}
                <img src={it.storage_url} alt={it.label ?? it.type} className="h-full w-full object-cover" draggable={false} />
                {it.label && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-1 text-[10px] text-white">{it.label}</span>
                )}
                <div
                  className="absolute bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-full border-2 border-white bg-blueprint shadow"
                  onPointerDown={(e) => handleResizePointerDown(e, it)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-blueprint/10 px-5 py-4">
          <p className="text-xs text-blueprint/50">
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-blueprint align-middle" /> Inspiration
            <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-amber align-middle" /> Material
          </p>
          <div className="flex gap-2">
            {collageImageUrl && (
              <button type="button" className="btn-ghost" onClick={onDownload}>
                Download
              </button>
            )}
            <button type="button" className="btn-outline" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn-primary" disabled={generating} onClick={onGenerate}>
              {generating ? "Generating…" : collageImageUrl ? "Regenerate & export" : "Generate & export"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
