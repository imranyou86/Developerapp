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
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; visible: boolean } | null>(null);
  const dragFixtureType = useRef<FixtureType | null>(null);

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

  // Dragging a NEW item in from the palette — the pointer starts outside
  // the canvas, so this tracks it with window-level listeners (pointer
  // capture only works once the pointer is already over the target
  // element, which isn't true here).
  function handlePaletteDragStart(e: React.PointerEvent, type: FixtureType) {
    e.preventDefault();
    dragFixtureType.current = type;
    setDragPreview({ x: e.clientX, y: e.clientY, visible: true });

    function onMove(ev: PointerEvent) {
      setDragPreview({ x: ev.clientX, y: ev.clientY, visible: true });
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const svg = svgRef.current;
      const ft = dragFixtureType.current;
      dragFixtureType.current = null;
      setDragPreview(null);
      if (!svg || !ft) return;
      const rect = svg.getBoundingClientRect();
      if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) {
        return; // dropped outside the room — ignore
      }
      const { x, y } = pointToFeet(svg, ev.clientX, ev.clientY, roomWidth, roomDepth);
      addItem(ft, x, y);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Repositioning an EXISTING item — pointer capture keeps move/up events
  // firing on this same element even once the cursor leaves it mid-drag,
  // so plain native listeners on it (not window-level ones) are enough.
  function handleItemPointerDown(e: React.PointerEvent<SVGGElement>, item: PlacedFixture) {
    e.stopPropagation();
    setSelectedId(item.id);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const { w, d } = footprint(item);

    function onMove(ev: PointerEvent) {
      const svg = svgRef.current;
      if (!svg) return;
      const { x, y } = pointToFeet(svg, ev.clientX, ev.clientY, roomWidth, roomDepth);
      const nextX = snap(clamp(x - w / 2, 0, Math.max(0, roomWidth - w)));
      const nextY = snap(clamp(y - d / 2, 0, Math.max(0, roomDepth - d)));
      onChange(items.map((it) => (it.id === item.id ? { ...it, x: nextX, y: nextY } : it)));
    }
    function onUp() {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    }
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  function handleRotate() {
    if (!selected) return;
    onChange(items.map((it) => (it.id === selected.id ? { ...it, rotated: !it.rotated } : it)));
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
            className="cursor-grab select-none rounded-md border border-blueprint/15 px-2 py-1 text-xs font-medium active:cursor-grabbing"
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
        className="w-full rounded-lg border border-blueprint/20 bg-white"
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
            <g key={item.id} onPointerDown={(e) => handleItemPointerDown(e, item)} className="cursor-move">
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

      {dragPreview?.visible && dragFixtureType.current && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border px-2 py-1 text-xs font-medium shadow-lg"
          style={{
            left: dragPreview.x + 8,
            top: dragPreview.y + 8,
            backgroundColor: `${dragFixtureType.current.color}dd`,
            borderColor: dragFixtureType.current.color,
          }}
        >
          {dragFixtureType.current.label}
        </div>
      )}
    </div>
  );
}
