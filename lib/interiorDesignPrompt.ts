// Deterministic, template-built prompt for OpenAI's image-edit call — no
// Claude round-trip needed, and short/front-loaded prompts are what image
// models actually follow well (the same lesson learned building the Rooms
// tab's "Generate image" prompt in lib room-concept route).
export function buildInteriorDesignPrompt(input: {
  roomType: string;
  style: string;
  width: number | null;
  depth: number | null;
  sqft: number | null;
}): string {
  const roomLabel = input.roomType.toLowerCase();
  const dims =
    input.width && input.depth
      ? `${input.width} x ${input.depth} ft (~${Math.round(input.width * input.depth)} sqft)`
      : input.sqft
        ? `~${input.sqft} sqft`
        : null;

  return [
    `Redesign this ${roomLabel} in a ${input.style} interior design style.`,
    `Photorealistic, fully finished and furnished — flooring, wall finish/paint, lighting fixtures, and ${roomLabel}-appropriate fixtures and furniture.`,
    dims ? `Room is approximately ${dims}.` : null,
    `Keep the room's existing architecture, structure, windows, doors, and camera angle unchanged — only add finishes, fixtures, and furniture.`,
    `Real estate listing photography quality, natural lighting.`,
  ]
    .filter(Boolean)
    .join(" ");
}
