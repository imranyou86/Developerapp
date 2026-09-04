"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getFixturesForRoomType, type FixtureType } from "@/lib/fixtureCatalog";
import { formatFeetInches } from "@/lib/feetInches";
import type { PlacedFixture } from "@/lib/types";

// Position/size snap to the nearest inch — decimal-foot snapping (e.g. the
// old 0.5ft/6") was too coarse for placing real fixtures accurately.
// Kept separate from GRID_SPACING (the visible reference lines), since a
// 1" grid would be far too dense to read at typical room sizes.
const SNAP = 1 / 12; // feet (1 inch)
const GRID_SPACING = 1; // feet, visual reference lines only
const MIN_SIZE = 0.25; // feet (3") — smallest a fixture can be resized to
const MARGIN = 1.4; // feet of space reserved outside the room for dimension rulers

function snap(n: number): number {
  return Math.round(n / SNAP) * SNAP;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

const fmt = formatFeetInches;

// Converts a pointer event's screen position into room-relative feet, using
// the SVG's actual rendered box and its viewBox (which includes MARGIN on
// each side for the dimension rulers, so it isn't simply roomWidth/roomDepth).
function pointToFeet(svg: SVGSVGElement, clientX: number, clientY: number, viewW: number, viewH: number) {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * viewW - MARGIN,
    y: ((clientY - rect.top) / rect.height) * viewH - MARGIN,
  };
}

// Keeps placed items inside the room after its dimensions change (e.g.
// switching which pre-added room is selected, or editing manual sizing) —
// called from the parent, not internally, since the parent owns `items`.
export function clampItemsToRoom(items: PlacedFixture[], roomWidth: number, roomDepth: number): PlacedFixture[] {
  return items.map((it) => {
    const w = it.rotated ? it.depth : it.width;
    const d = it.rotated ? it.width : it.depth;
    return {
      ...it,
      x: clamp(it.x, 0, Math.max(0, roomWidth - w)),
      y: clamp(it.y, 0, Math.max(0, roomDepth - d)),
    };
  });
}

interface ItemRefs {
  rect: SVGRectElement;
  label: SVGTextElement;
  size: SVGTextElement;
  handle: SVGRectElement;
}

function DimensionLine({
  x1,
  y1,
  x2,
  y2,
  label,
  vertical,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  vertical?: boolean;
}) {
  const tick = 0.12;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <g stroke="#8A8580" strokeWidth={0.015} className="select-none">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x1} y1={y1 - tick} x2={x1} y2={y1 + tick} />
      <line x1={x2} y1={y2 - tick} x2={x2} y2={y2 + tick} />
      <text
        x={midX}
        y={midY}
        fontSize={0.28}
        fill="#5E5348"
        textAnchor="middle"
        dominantBaseline="middle"
        transform={vertical ? `rotate(-90, ${midX}, ${midY})` : undefined}
        stroke="none"
      >
        {label}
      </text>
    </g>
  );
}

export function RoomLayoutEditor({
  roomType,
  roomWidth,
  roomDepth,
  items,
  onChange,
}: {
  roomType: string;
  roomWidth: number;
  roomDepth: number;
  items: PlacedFixture[];
  onChange: (items: PlacedFixture[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const itemRefs = useRef<Map<string, ItemRefs>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fixtures = getFixturesForRoomType(roomType);
  const selected = items.find((it) => it.id === selectedId) ?? null;
  const viewW = roomWidth + MARGIN * 2;
  const viewH = roomDepth + MARGIN * 2;
  // Scale the resize/rotate touch targets with room size so they stay
  // comfortably grabbable in both a tiny closet and a large great room.
  const handleSize = clamp(Math.max(roomWidth, roomDepth) * 0.035, 0.28, 0.6);

  function footprint(item: PlacedFixture) {
    return item.rotated ? { w: item.depth, d: item.width } : { w: item.width, d: item.depth };
  }

  function setItemRef(id: string, key: keyof ItemRefs, el: SVGRectElement | SVGTextElement | null) {
    if (!el) return;
    const existing = (itemRefs.current.get(id) ?? {}) as unknown as Record<string, unknown>;
    existing[key] = el;
    itemRefs.current.set(id, existing as unknown as ItemRefs);
  }

  function addItem(type: FixtureType, xCenter: number, yCenter: number) {
    const x = snap(clamp(xCenter - type.width / 2, 0, Math.max(0, roomWidth - type.width)));
    const y = snap(clamp(yCenter - type.depth / 2, 0, Math.max(0, roomDepth - type.depth)));
    const item: PlacedFixture = {
      id: crypto.randomUUID(),
      typeId: type.id,
      label: type.label,
      x,
      y,
      width: type.width,
      depth: type.depth,
      rotated: false,
    };
    onChange([...items, item]);
    setSelectedId(item.id);
  }

  // Dragging a NEW item in from the palette. The pointer starts outside the
  // canvas (on the palette chip), so this tracks it with window-level
  // listeners rather than pointer capture, which only works once the
  // pointer is already over the capturing element. The ghost preview is a
  // raw DOM node moved by direct style writes, not React state, so
  // dragging doesn't force a re-render on every pointer move.
  function handlePaletteDragStart(e: React.PointerEvent, type: FixtureType) {
    e.preventDefault();

    const ghost = document.createElement("div");
    ghost.textContent = type.label;
    ghost.style.cssText = `position:fixed;z-index:50;pointer-events:none;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:500;box-shadow:0 2px 8px rgba(0,0,0,0.15);border:1px solid ${type.color};background:${type.color};color:#1F1F1D;`;
    const place = (x: number, y: number) => {
      ghost.style.left = `${x + 12}px`;
      ghost.style.top = `${y + 12}px`;
    };
    place(e.clientX, e.clientY);
    document.body.appendChild(ghost);

    function onMove(ev: PointerEvent) {
      place(ev.clientX, ev.clientY);
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      ghost.remove();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) {
        return; // dropped outside the canvas — ignore
      }
      const { x, y } = pointToFeet(svg, ev.clientX, ev.clientY, viewW, viewH);
      addItem(type, x, y);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Repositioning an EXISTING item. Pointer capture keeps move/up events
  // firing on this element even once the cursor leaves it mid-drag, so
  // plain listeners on it (not window-level ones) are enough. The item
  // follows the cursor via a live SVG `transform` on the group — direct
  // DOM writes, no React re-render — preserving the offset between where
  // you grabbed it and its origin, so it doesn't jump to re-center under
  // the cursor. Position only snaps to the grid once, on release.
  function handleItemPointerDown(e: React.PointerEvent<SVGGElement>, item: PlacedFixture) {
    e.stopPropagation();
    setSelectedId(item.id);
    const svg = svgRef.current;
    if (!svg) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const { w, d } = footprint(item);
    const grabStart = pointToFeet(svg, e.clientX, e.clientY, viewW, viewH);
    const grabDx = grabStart.x - item.x;
    const grabDy = grabStart.y - item.y;
    let finalX = item.x;
    let finalY = item.y;
    let moved = false;

    function onMove(ev: PointerEvent) {
      moved = true;
      const p = pointToFeet(svg!, ev.clientX, ev.clientY, viewW, viewH);
      finalX = clamp(p.x - grabDx, 0, Math.max(0, roomWidth - w));
      finalY = clamp(p.y - grabDy, 0, Math.max(0, roomDepth - d));
      target.setAttribute("transform", `translate(${finalX - item.x}, ${finalY - item.y})`);
    }
    function onUp() {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeAttribute("transform");
      if (moved) {
        const snappedX = snap(finalX);
        const snappedY = snap(finalY);
        onChange(items.map((it) => (it.id === item.id ? { ...it, x: snappedX, y: snappedY } : it)));
      }
    }
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  // Resizing the SELECTED item from its bottom-right handle, anchored at
  // its top-left corner (x/y don't move). Same direct-DOM-write approach as
  // moving — the rect/label/size-caption/handle are updated live via refs,
  // with the final size only snapped to the grid and committed to state on
  // release.
  function handleResizePointerDown(e: React.PointerEvent<SVGRectElement>, item: PlacedFixture) {
    e.stopPropagation();
    setSelectedId(item.id);
    const svg = svgRef.current;
    if (!svg) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const refs = itemRefs.current.get(item.id);

    const { w: startW, d: startD } = footprint(item);
    // Same offset-preservation as moving an item — the handle is small, so
    // without this a grab anywhere but its exact center would jump the
    // fixture's edge to the cursor on the very first pointermove.
    const grabStart = pointToFeet(svg, e.clientX, e.clientY, viewW, viewH);
    const grabDx = grabStart.x - (item.x + startW);
    const grabDy = grabStart.y - (item.y + startD);
    let finalW = startW;
    let finalD = startD;

    function onMove(ev: PointerEvent) {
      const p = pointToFeet(svg!, ev.clientX, ev.clientY, viewW, viewH);
      const rawW = p.x - grabDx - item.x;
      const rawD = p.y - grabDy - item.y;
      finalW = clamp(rawW, MIN_SIZE, Math.max(MIN_SIZE, roomWidth - item.x));
      finalD = clamp(rawD, MIN_SIZE, Math.max(MIN_SIZE, roomDepth - item.y));
      if (!refs) return;
      refs.rect.setAttribute("width", String(finalW));
      refs.rect.setAttribute("height", String(finalD));
      // `label` only exists in the DOM for items rendered large enough to
      // show one (see `compact` below) — a small fixture resized larger
      // mid-drag won't grow a label until the next real render on release.
      if (refs.label) {
        refs.label.setAttribute("x", String(item.x + finalW / 2));
        refs.label.setAttribute("y", String(item.y + finalD / 2 - Math.min(finalW, finalD) * 0.14));
      }
      refs.size.setAttribute("x", String(item.x + finalW / 2));
      refs.size.setAttribute("y", String(item.y + finalD / 2 + Math.min(finalW, finalD) * 0.14));
      refs.size.textContent = `${fmt(finalW)} × ${fmt(finalD)}`;
      refs.handle.setAttribute("x", String(item.x + finalW - handleSize / 2));
      refs.handle.setAttribute("y", String(item.y + finalD - handleSize / 2));
    }
    function onUp() {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      const snappedW = snap(finalW);
      const snappedD = snap(finalD);
      const nextWidth = item.rotated ? snappedD : snappedW;
      const nextDepth = item.rotated ? snappedW : snappedD;
      onChange(items.map((it) => (it.id === item.id ? { ...it, width: nextWidth, depth: nextDepth } : it)));
    }
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  function handleRotate() {
    if (!selected) return;
    const { w, d } = footprint(selected);
    // Rotating in place can push a corner-hugging item out of bounds
    // (footprint's width/depth swap) — reclamp immediately after.
    const rotatedFootprintW = d;
    const rotatedFootprintD = w;
    const x = clamp(selected.x, 0, Math.max(0, roomWidth - rotatedFootprintW));
    const y = clamp(selected.y, 0, Math.max(0, roomDepth - rotatedFootprintD));
    onChange(items.map((it) => (it.id === selected.id ? { ...it, rotated: !it.rotated, x, y } : it)));
  }

  function handleDelete() {
    if (!selected) return;
    onChange(items.filter((it) => it.id !== selected.id));
    itemRefs.current.delete(selected.id);
    setSelectedId(null);
  }

  // Delete/Backspace removes the selected fixture — skipped while typing in
  // a form field elsewhere on the page (e.g. the style/dimensions inputs),
  // so backspacing text there doesn't also delete the current selection.
  useEffect(() => {
    if (!selectedId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      e.preventDefault();
      handleDelete();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Escape exits full screen, matching components/Modal.tsx's convention.
  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const canvas = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {fixtures.map((f) => (
            <button
              key={f.id}
              type="button"
              className="cursor-grab select-none touch-none rounded-md border border-blueprint/15 px-2 py-1 text-xs font-medium active:cursor-grabbing"
              style={{ backgroundColor: `${f.color}22`, borderColor: f.color }}
              onPointerDown={(e) => handlePaletteDragStart(e, f)}
            >
              {f.label} — {fmt(f.width)} × {fmt(f.depth)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn-ghost shrink-0 whitespace-nowrap px-2 py-1 text-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Exit full screen" : "Full screen ⤢"}
        </button>
      </div>
      <p className="mb-2 text-xs text-blueprint/40">
        Drag a fixture onto the room, drag it to reposition, or drag its bottom-right corner to resize. Positions
        and sizes snap to the nearest inch and are shown in feet-inches (e.g. 4&apos;6&quot;), to scale with the
        room.
      </p>

      <svg
        ref={svgRef}
        viewBox={`${-MARGIN} ${-MARGIN} ${viewW} ${viewH}`}
        className="w-full touch-none rounded-lg border border-blueprint/20 bg-white"
        style={{ maxWidth: expanded ? 1100 : 560, aspectRatio: `${viewW} / ${viewH}` }}
        onPointerDown={() => setSelectedId(null)}
      >
        <rect x={0} y={0} width={roomWidth} height={roomDepth} fill="#FAFAF7" stroke="#3A3A38" strokeWidth={0.04} />

        {Array.from({ length: Math.floor(roomWidth / GRID_SPACING) + 1 }).map((_, i) => (
          <line key={`v${i}`} x1={i * GRID_SPACING} y1={0} x2={i * GRID_SPACING} y2={roomDepth} stroke="#EDE7DD" strokeWidth={0.02} />
        ))}
        {Array.from({ length: Math.floor(roomDepth / GRID_SPACING) + 1 }).map((_, i) => (
          <line key={`h${i}`} x1={0} y1={i * GRID_SPACING} x2={roomWidth} y2={i * GRID_SPACING} stroke="#EDE7DD" strokeWidth={0.02} />
        ))}

        <DimensionLine x1={0} y1={-MARGIN * 0.55} x2={roomWidth} y2={-MARGIN * 0.55} label={fmt(roomWidth)} />
        <DimensionLine x1={-MARGIN * 0.55} y1={0} x2={-MARGIN * 0.55} y2={roomDepth} label={fmt(roomDepth)} vertical />

        {items.map((item) => {
          const { w, d } = footprint(item);
          const isSelected = item.id === selectedId;
          const fixtureColor = fixtures.find((f) => f.id === item.typeId)?.color ?? "#8A8580";
          const compact = Math.min(w, d) <= 1.4;
          return (
            <g key={item.id} onPointerDown={(e) => handleItemPointerDown(e, item)} className="cursor-move touch-none">
              <rect
                ref={(el) => setItemRef(item.id, "rect", el)}
                x={item.x}
                y={item.y}
                width={w}
                height={d}
                fill={fixtureColor}
                fillOpacity={0.75}
                stroke={isSelected ? "#C9822B" : "#3A3A38"}
                strokeWidth={isSelected ? 0.08 : 0.03}
              />
              {!compact && (
                <text
                  ref={(el) => setItemRef(item.id, "label", el)}
                  x={item.x + w / 2}
                  y={item.y + d / 2 - Math.min(w, d) * 0.14}
                  fontSize={Math.min(w, d) > 2 ? 0.32 : 0.24}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#1F1F1D"
                  className="pointer-events-none select-none"
                >
                  {item.label}
                </text>
              )}
              <text
                ref={(el) => setItemRef(item.id, "size", el)}
                x={item.x + w / 2}
                y={compact ? item.y + d / 2 : item.y + d / 2 + Math.min(w, d) * 0.14}
                fontSize={Math.min(w, d) > 2 ? 0.24 : 0.18}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#1F1F1D"
                fillOpacity={0.75}
                className="pointer-events-none select-none"
              >
                {fmt(w)} × {fmt(d)}
              </text>
              {isSelected && (
                <>
                  <rect
                    ref={(el) => setItemRef(item.id, "handle", el)}
                    x={item.x + w - handleSize / 2}
                    y={item.y + d - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    fill="#ffffff"
                    stroke="#C9822B"
                    strokeWidth={0.05}
                    className="cursor-nwse-resize touch-none"
                    onPointerDown={(e) => handleResizePointerDown(e, item)}
                  />
                  <g
                    className="cursor-pointer touch-none"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handleDelete();
                    }}
                  >
                    <circle cx={item.x + w} cy={item.y} r={handleSize / 2} fill="#DC2626" stroke="#ffffff" strokeWidth={0.03} />
                    <text
                      x={item.x + w}
                      y={item.y}
                      fontSize={handleSize * 0.8}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#ffffff"
                      className="pointer-events-none select-none"
                    >
                      ×
                    </text>
                  </g>
                </>
              )}
            </g>
          );
        })}
      </svg>

      {selected && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-blueprint/60">
            Selected: {selected.label} ({fmt(footprint(selected).w)} × {fmt(footprint(selected).d)})
          </span>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={handleRotate}>
            Rotate 90°
          </button>
          <button type="button" className="text-red-500 hover:underline" onClick={handleDelete}>
            Delete
          </button>
        </div>
      )}
    </>
  );

  if (expanded && typeof document !== "undefined") {
    return createPortal(
      <div className="fixed inset-0 z-[70] overflow-auto bg-blueprint-dark/40 p-4 sm:p-8">
        <div className="mx-auto w-full max-w-[1200px] rounded-xl bg-white p-4 shadow-xl sm:p-6">{canvas}</div>
      </div>,
      document.body
    );
  }

  return <div>{canvas}</div>;
}
