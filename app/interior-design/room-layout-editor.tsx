"use client";

import { useRef, useState } from "react";
import { getFixturesForRoomType, type FixtureType } from "@/lib/fixtureCatalog";
import type { PlacedFixture } from "@/lib/types";

const SNAP = 0.5; // feet

function snap(n: number): number {
  return Math.round(n / SNAP) * SNAP;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

// Converts a pointer event's screen position into room-relative feet,
// using the SVG's actual rendered box (the viewBox is in feet, so this is
// the only place px<->ft conversion has to happen).
function pointToFeet(svg: SVGSVGElement, clientX: number, clientY: number, roomWidth: number, roomDepth: number) {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * roomWidth,
    y: ((clientY - rect.top) / rect.height) * roomDepth,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fixtures = getFixturesForRoomType(roomType);
  const selected = items.find((it) => it.id === selectedId) ?? null;

  function footprint(item: PlacedFixture) {
    return item.rotated ? { w: item.depth, d: item.width } : { w: item.width, d: item.depth };
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
        return; // dropped outside the room — ignore
      }
      const { x, y } = pointToFeet(svg, ev.clientX, ev.clientY, roomWidth, roomDepth);
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
    const grabStart = pointToFeet(svg, e.clientX, e.clientY, roomWidth, roomDepth);
    const grabDx = grabStart.x - item.x;
    const grabDy = grabStart.y - item.y;
    let finalX = item.x;
    let finalY = item.y;
    let moved = false;

    function onMove(ev: PointerEvent) {
      moved = true;
      const p = pointToFeet(svg!, ev.clientX, ev.clientY, roomWidth, roomDepth);
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
    setSelectedId(null);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {fixtures.map((f) => (
          <button
            key={f.id}
            type="button"
            className="cursor-grab select-none touch-none rounded-md border border-blueprint/15 px-2 py-1 text-xs font-medium active:cursor-grabbing"
            style={{ backgroundColor: `${f.color}22`, borderColor: f.color }}
            onPointerDown={(e) => handlePaletteDragStart(e, f)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs text-blueprint/40">Drag a fixture onto the room below, then drag it into place.</p>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${roomWidth} ${roomDepth}`}
        className="w-full touch-none rounded-lg border border-blueprint/20 bg-white"
        style={{ maxWidth: 520, aspectRatio: `${roomWidth} / ${roomDepth}` }}
        onPointerDown={() => setSelectedId(null)}
      >
        {Array.from({ length: Math.floor(roomWidth / SNAP) + 1 }).map((_, i) => (
          <line key={`v${i}`} x1={i * SNAP} y1={0} x2={i * SNAP} y2={roomDepth} stroke="#EDE7DD" strokeWidth={0.02} />
        ))}
        {Array.from({ length: Math.floor(roomDepth / SNAP) + 1 }).map((_, i) => (
          <line key={`h${i}`} x1={0} y1={i * SNAP} x2={roomWidth} y2={i * SNAP} stroke="#EDE7DD" strokeWidth={0.02} />
        ))}

        {items.map((item) => {
          const { w, d } = footprint(item);
          const isSelected = item.id === selectedId;
          return (
            <g
              key={item.id}
              onPointerDown={(e) => handleItemPointerDown(e, item)}
              className="cursor-move touch-none"
            >
              <rect
                x={item.x}
                y={item.y}
                width={w}
                height={d}
                fill={fixtures.find((f) => f.id === item.typeId)?.color ?? "#8A8580"}
                fillOpacity={0.75}
                stroke={isSelected ? "#C9822B" : "#3A3A38"}
                strokeWidth={isSelected ? 0.08 : 0.03}
              />
              <text
                x={item.x + w / 2}
                y={item.y + d / 2}
                fontSize={Math.min(w, d) > 2 ? 0.35 : 0.25}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#1F1F1D"
                className="pointer-events-none select-none"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>

      {selected && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-blueprint/60">Selected: {selected.label}</span>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={handleRotate}>
            Rotate 90°
          </button>
          <button type="button" className="text-red-500 hover:underline" onClick={handleDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
