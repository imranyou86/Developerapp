// Shared between the server-side collage composer (lib/moodBoard.ts, which
// imports sharp) and the client-side arrange canvas
// (components/MoodBoardCanvas.tsx) — pure numbers/types only, no sharp
// import, so this is safe inside a "use client" bundle.
//
// A mood board's freeform layout is stored as fractions (0-1) of a fixed
// BOARD_WIDTH x BOARD_HEIGHT canvas, not pixels — so the same item
// positions line up identically whether rendered in the browser (at
// whatever size the canvas happens to be on screen) or composed server-side
// into the final export image.

export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 1200;
export const BOARD_ASPECT = BOARD_WIDTH / BOARD_HEIGHT;
const MAX_BOARD_COLS = 4;
const GRID_GAP_PX = 24;

export interface MoodBoardLayoutItem {
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
}

export type PositionedItem<T> = T & { x: number; y: number; width: number; height: number };

function hasPosition(item: MoodBoardLayoutItem): boolean {
  return item.x != null && item.y != null && item.width != null && item.height != null;
}

export function hasFullLayout(items: MoodBoardLayoutItem[]): boolean {
  return items.length > 0 && items.every(hasPosition);
}

// Seeds a simple grid starting position (as fractions of BOARD_WIDTH/
// BOARD_HEIGHT, visually-square tiles) for any item missing one, leaving
// already-positioned items untouched. Used both to give a never-arranged
// board something sensible the moment its canvas first opens, and as the
// collage generator's own fallback for a board that was never arranged at
// all — same math, so a generated collage before any dragging matches what
// the canvas would show.
export function assignDefaultPositions<T extends MoodBoardLayoutItem>(items: T[]): PositionedItem<T>[] {
  const cols = Math.min(MAX_BOARD_COLS, Math.ceil(Math.sqrt(items.length)) || 1);
  const tileWPx = (BOARD_WIDTH - GRID_GAP_PX * (cols + 1)) / cols;
  const tileHPx = tileWPx; // square tiles by default
  const widthFrac = tileWPx / BOARD_WIDTH;
  const heightFrac = tileHPx / BOARD_HEIGHT;

  return items.map((item, i) => {
    if (hasPosition(item)) {
      return item as PositionedItem<T>;
    }
    const col = i % cols;
    const row = Math.floor(i / cols);
    const xPx = GRID_GAP_PX + col * (tileWPx + GRID_GAP_PX);
    const yPx = GRID_GAP_PX + row * (tileHPx + GRID_GAP_PX);
    return { ...item, x: xPx / BOARD_WIDTH, y: yPx / BOARD_HEIGHT, width: widthFrac, height: heightFrac };
  });
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
