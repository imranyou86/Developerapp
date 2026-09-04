import { formatFeetInches } from "@/lib/feetInches";
import type { PlacedFixture } from "@/lib/types";

// Rough zone label from a fixture's position within the room — image
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

// Turns the 2D layout editor's placed items into an explicit, numbered
// instruction block rather than one dense sentence — a wall of semicolons
// is easy for an image model to skim past or partially ignore; a numbered
// "do exactly this" list is what actually gets followed. This is what
// makes the render reflect the chosen arrangement (island placement,
// which wall the cabinets/vanity run along, etc.) instead of the model
// inventing its own.
export function describeLayout(items: PlacedFixture[], roomWidth: number, roomDepth: number): string {
  if (items.length === 0) return "";
  const lines = items.map(
    (it, i) => `${i + 1}. ${it.label}, ${formatFeetInches(it.width)} x ${formatFeetInches(it.depth)}, ${describePosition(it, roomWidth, roomDepth)}`
  );
  return `FIXTURE PLACEMENT — follow this exactly, to scale within the room, and do not add any other furniture or fixtures beyond this list:\n${lines.join("\n")}`;
}

// Deterministic, template-built prompt for OpenAI's image call — no Claude
// round-trip needed, and short/front-loaded prompts are what image models
// actually follow well (the same lesson learned building the Rooms tab's
// "Generate image" prompt). The explicit placement list is given early and
// its own paragraph, ahead of the softer style/finish language, since
// that's the part that actually needs to be followed literally rather
// than just informing the vibe.
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
      ? `${formatFeetInches(input.width)} x ${formatFeetInches(input.depth)} (~${Math.round(input.width * input.depth)} sqft)`
      : input.sqft
        ? `~${input.sqft} sqft`
        : null;
  const hasLayout = !!input.layoutDescription;

  const parts: (string | null)[] = [];

  if (input.hasPhoto) {
    parts.push(`Redesign this ${roomLabel} in a ${input.style} interior design style.`);
  } else {
    // Fully control the camera here (no source photo to inherit an angle
    // from) so it actually lines up with the plan's back/front convention
    // used in the placement list below — without this, "along the back
    // wall" has no reliable meaning to the model.
    parts.push(
      `Generate a photorealistic ${roomLabel} in a ${input.style} interior design style, photographed from just inside the doorway looking straight across the room toward the far ("back") wall, at natural eye level, as if for a real estate listing.`
    );
  }

  if (hasLayout) {
    parts.push(input.layoutDescription!);
    if (input.hasPhoto) {
      // A real uploaded photo has its own arbitrary camera angle that the
      // plan's abstract back/front/left/right axes can't be assumed to
      // match — ask the model to reconcile them against what it can
      // actually see, rather than pretending they're the same frame.
      parts.push(
        `Map that placement onto the room as actually shown in the photo: treat whichever wall is farthest from the camera as "back"/"far", the wall closest to the camera as "front"/"near", and left/right as they appear in the photo itself.`
      );
    }
  }

  parts.push(
    hasLayout
      ? `Fully finished — flooring, wall finish/paint, and lighting throughout, in addition to the fixture list above.`
      : `Fully finished — flooring, wall finish/paint, lighting fixtures, and ${roomLabel}-appropriate fixtures and furniture.`
  );

  if (dims) parts.push(`Room is approximately ${dims}.`);

  if (input.hasPhoto) {
    parts.push(
      `Keep the room's existing architecture, structure, windows, doors, and camera angle unchanged — only add finishes, fixtures, and furniture.`
    );
  }

  parts.push(`Real estate listing photography quality, natural lighting.`);

  return parts.filter(Boolean).join(" ");
}
