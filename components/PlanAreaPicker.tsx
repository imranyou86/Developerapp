"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface PlanAreaPickerPage {
  label: string;
  storage_url: string;
}

export interface PlanAreaSelection {
  url: string;
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Corner = "nw" | "ne" | "sw" | "se";
type DragMode = { kind: "draw" } | { kind: "move"; grabDx: number; grabDy: number } | { kind: "resize"; corner: Corner };

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

const DEFAULT_BOX: Box = { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 };
const MIN_BOX_FRACTION = 0.03;

// Full-bleed overlay (same pattern as FileViewerModal) rather than the
// shared Modal — this needs to show a plan page near-full-size with an
// interactive selection rectangle over it, not a small padded card.
export function PlanAreaPicker({
  pages,
  initialPageIndex = 0,
  onConfirm,
  onClose,
}: {
  pages: PlanAreaPickerPage[];
  initialPageIndex?: number;
  onConfirm: (selection: PlanAreaSelection) => void;
  onClose: () => void;
}) {
  const [pageIndex, setPageIndex] = useState(Math.min(initialPageIndex, pages.length - 1));
  const [box, setBox] = useState<Box>(DEFAULT_BOX);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ mode: DragMode; startBox: Box } | null>(null);

  const page = pages[pageIndex];

  function fractionAt(clientX: number, clientY: number): { fx: number; fy: number } {
    const rect = imgRef.current!.getBoundingClientRect();
    return {
      fx: clamp01((clientX - rect.left) / rect.width),
      fy: clamp01((clientY - rect.top) / rect.height),
    };
  }

  function handleMove(e: PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const { fx, fy } = fractionAt(e.clientX, e.clientY);

    if (drag.mode.kind === "draw") {
      const start = drag.startBox;
      setBox({ x0: Math.min(start.x0, fx), y0: Math.min(start.y0, fy), x1: Math.max(start.x0, fx), y1: Math.max(start.y0, fy) });
    } else if (drag.mode.kind === "move") {
      const start = drag.startBox;
      const w = start.x1 - start.x0;
      const h = start.y1 - start.y0;
      let x0 = fx - drag.mode.grabDx;
      let y0 = fy - drag.mode.grabDy;
      x0 = clamp01(Math.min(x0, 1 - w));
      y0 = clamp01(Math.min(y0, 1 - h));
      setBox({ x0, y0, x1: x0 + w, y1: y0 + h });
    } else {
      const start = drag.startBox;
      const next = { ...start };
      if (drag.mode.corner === "nw") {
        next.x0 = Math.min(fx, start.x1 - 0.01);
        next.y0 = Math.min(fy, start.y1 - 0.01);
      } else if (drag.mode.corner === "ne") {
        next.x1 = Math.max(fx, start.x0 + 0.01);
        next.y0 = Math.min(fy, start.y1 - 0.01);
      } else if (drag.mode.corner === "sw") {
        next.x0 = Math.min(fx, start.x1 - 0.01);
        next.y1 = Math.max(fy, start.y0 + 0.01);
      } else {
        next.x1 = Math.max(fx, start.x0 + 0.01);
        next.y1 = Math.max(fy, start.y0 + 0.01);
      }
      setBox(next);
    }
  }

  function endDrag() {
    dragRef.current = null;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", endDrag);
  }

  function startDrag(mode: DragMode, startBox: Box) {
    dragRef.current = { mode, startBox };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", endDrag);
  }

  function handleBackgroundPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const { fx, fy } = fractionAt(e.clientX, e.clientY);
    const start = { x0: fx, y0: fy, x1: fx, y1: fy };
    setBox(start);
    startDrag({ kind: "draw" }, start);
  }

  function handleBoxPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const { fx, fy } = fractionAt(e.clientX, e.clientY);
    startDrag({ kind: "move", grabDx: fx - box.x0, grabDy: fy - box.y0 }, box);
  }

  function handleHandlePointerDown(corner: Corner) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      startDrag({ kind: "resize", corner }, box);
    };
  }

  const boxWidthFraction = box.x1 - box.x0;
  const boxHeightFraction = box.y1 - box.y0;
  const boxTooSmall = boxWidthFraction < MIN_BOX_FRACTION || boxHeightFraction < MIN_BOX_FRACTION;

  const handleStyle = "absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blueprint shadow";

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-blueprint-dark/70 p-4 animate-fade-in">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-elevated animate-scale-in">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-blueprint/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-blueprint-dark">Select the area to focus on</h2>
            <p className="text-xs text-blueprint/50">Drag to draw a box around the room, or drag the box/handles to adjust it.</p>
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

        {pages.length > 1 && (
          <div className="shrink-0 border-b border-blueprint/10 px-5 py-2">
            <select
              className="input py-1 text-sm"
              value={pageIndex}
              onChange={(e) => {
                setPageIndex(Number(e.target.value));
                setBox(DEFAULT_BOX);
              }}
            >
              {pages.map((p, i) => (
                <option key={p.storage_url} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-1 items-center justify-center overflow-auto bg-concrete/40 p-4">
          <div className="relative inline-block select-none" style={{ touchAction: "none" }} onPointerDown={handleBackgroundPointerDown}>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed/remote plan page URL, not a next/image remote source */}
            <img
              ref={imgRef}
              src={page.storage_url}
              alt={`Plan page: ${page.label}`}
              className="block max-h-[65vh] max-w-full"
              draggable={false}
            />
            <div
              className="absolute cursor-move border-2 border-amber bg-amber/10"
              style={{
                left: `${box.x0 * 100}%`,
                top: `${box.y0 * 100}%`,
                width: `${boxWidthFraction * 100}%`,
                height: `${boxHeightFraction * 100}%`,
                touchAction: "none",
              }}
              onPointerDown={handleBoxPointerDown}
            >
              <div className={`${handleStyle} left-0 top-0 cursor-nwse-resize`} onPointerDown={handleHandlePointerDown("nw")} />
              <div className={`${handleStyle} right-0 top-0 translate-x-1/2 cursor-nesw-resize`} onPointerDown={handleHandlePointerDown("ne")} />
              <div className={`${handleStyle} bottom-0 left-0 translate-y-1/2 cursor-nesw-resize`} onPointerDown={handleHandlePointerDown("sw")} />
              <div
                className={`${handleStyle} bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize`}
                onPointerDown={handleHandlePointerDown("se")}
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-blueprint/10 px-5 py-4">
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setBox(DEFAULT_BOX)}>
            Reset selection
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={boxTooSmall}
              title={boxTooSmall ? "Draw a larger box around the room" : undefined}
              onClick={() =>
                onConfirm({ url: page.storage_url, label: page.label, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 })
              }
            >
              Use this area
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
