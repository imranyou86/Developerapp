import type { PlacedFixture } from "@/lib/types";

// Rough zone label from a fixture's position within the room — image
// models can't use real coordinates, but they follow "along the back
// wall"/"centered"/"in the northeast corner" well. Thresholds split each
// axis into thirds.
function zoneLabel(centerFrac: number, lowLabel: string, highLabel: string): string | null {
  if (centerFrac < 0.33) return lowLabel;
  if (centerFrac > 0.67) return highLabel;
  return null;
}

function describePosition(item: PlacedFixture, roomWidth: number, roomDepth: number): string {
  const cx = (item.x + item.width / 2) / roomWidth;
  const cy = (item.y + item.depth / 2) / roomDepth;
  const horizontal = zoneLabel(cx, "left", "right");
  const vertical = zoneLabel(cy, "back", "front");

  if (horizontal && vertical) return `in the ${vertical}-${horizontal} corner`;
  if (vertical) return `along the ${vertical} wall`;
  if (horizontal) return `along the ${horizontal} wall`;
  return "centered in the room";
}

// Turns the 2D layout editor's placed items into a short, concrete
// sentence the image model can actually follow — this is what makes the
// render reflect a chosen arrangement (island placement, which wall the
// cabinets/vanity run along, etc.) instead of the model inventing one.
export function describeLayout(items: PlacedFixture[], roomWidth: number, roomDepth: number): string {
  if (items.length === 0) return "";
  const parts = items.map((it) => `${it.label} (about ${it.width}' x ${it.depth}') ${describePosition(it, roomWidth, roomDepth)}`);
  return `Lay out exactly these fixtures/furniture as described, matching the room's real proportions: ${parts.join("; ")}.`;
}

// Deterministic, template-built prompt for OpenAI's image call — no Claude
// round-trip needed, and short/front-loaded prompts are what image models
// actually follow well (the same lesson learned building the Rooms tab's
// "Generate image" prompt).
export function buildInteriorDesignPrompt(input: {
  roomType: string;
  style: string;
  width: number | null;
  depth: number | null;
  sqft: number | null;
  hasPhoto: boolean;
  layoutDescription?: string;
}): string {
  const roomLabel = input.roomType.toLowerCase();
  const dims =
    input.width && input.depth
      ? `${input.width} x ${input.depth} ft (~${Math.round(input.width * input.depth)} sqft)`
      : input.sqft
        ? `~${input.sqft} sqft`
        : null;

  return [
    input.hasPhoto
      ? `Redesign this ${roomLabel} in a ${input.style} interior design style.`
      : `Generate a photorealistic ${roomLabel} in a ${input.style} interior design style, viewed from a natural eye-level angle as if photographed for a real estate listing.`,
    `Fully finished — flooring, wall finish/paint, lighting fixtures, and ${roomLabel}-appropriate fixtures and furniture.`,
    dims ? `Room is approximately ${dims}.` : null,
    input.layoutDescription || null,
    input.hasPhoto
      ? `Keep the room's existing architecture, structure, windows, doors, and camera angle unchanged — only add finishes, fixtures, and furniture.`
      : null,
    `Real estate listing photography quality, natural lighting.`,
  ]
    .filter(Boolean)
    .join(" ");
}
