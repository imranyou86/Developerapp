import { formatFeetInches } from "@/lib/feetInches";
import type { PlacedFixture } from "@/lib/types";

// Shared by Interior Design's room layout and Landscape's yard layout —
// both are "place items on a 2D rectangle, describe the result for an
// image model" the same way, just with a different item catalog
// (lib/fixtureCatalog.ts vs lib/landscapeCatalog.ts) and different domain
// words (sideLabel/elementNoun below), defaulted to Interior Design's
// original wording so this extraction doesn't change its existing prompts.

// Rough zone label from a fixture's position within the area — image
// models can't use real coordinates, but they follow "along the back
// wall"/"centered"/"in the back-right corner" reasonably well. Thresholds
// split each axis into thirds. IMPORTANT: "back"/"front"/"left"/"right"
// here describe the 2D top-down plan's own axes (y=0 is the plan's "back"),
// which has no inherent relationship to any camera angle — see the prompt-
// building notes below on why that has to be reconciled explicitly.
function zoneLabel(centerFrac: number, lowLabel: string, highLabel: string): string | null {
  if (centerFrac < 0.33) return lowLabel;
  if (centerFrac > 0.67) return highLabel;
  return null;
}

function describePosition(item: PlacedFixture, areaWidth: number, areaDepth: number, sideLabel: string): string {
  const cx = (item.x + item.width / 2) / areaWidth;
  const cy = (item.y + item.depth / 2) / areaDepth;
  const horizontal = zoneLabel(cx, "left", "right");
  const vertical = zoneLabel(cy, "back", "front");

  if (horizontal && vertical) return `in the ${vertical}-${horizontal} corner`;
  if (vertical) return `along the ${vertical} ${sideLabel}`;
  if (horizontal) return `along the ${horizontal} ${sideLabel}`;
  return "centered in the area";
}

// Turns the 2D layout editor's placed items into an explicit, numbered
// instruction block rather than one dense sentence — a wall of semicolons
// is easy for an image model to skim past or partially ignore; a numbered
// "do exactly this" list is what actually gets followed. This is what
// makes the render reflect the chosen arrangement (island placement, which
// wall the cabinets/vanity run along, a pool's corner, etc.) instead of the
// model inventing its own.
export function describeLayout(
  items: PlacedFixture[],
  areaWidth: number,
  areaDepth: number,
  options?: { sideLabel?: string; elementNoun?: string }
): string {
  if (items.length === 0) return "";
  const sideLabel = options?.sideLabel ?? "wall";
  const elementNoun = options?.elementNoun ?? "furniture or fixtures";
  const lines = items.map((it, i) => {
    const base = `${i + 1}. ${it.label}, ${formatFeetInches(it.width)} x ${formatFeetInches(it.depth)}, ${describePosition(it, areaWidth, areaDepth, sideLabel)}`;
    return it.detail?.trim() ? `${base} — ${it.detail.trim()}` : base;
  });
  return `PLACEMENT — follow this exactly, to scale within the area, and do not add any other ${elementNoun} beyond this list:\n${lines.join("\n")}`;
}
