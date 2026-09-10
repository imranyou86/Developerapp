// Deterministic, template-built prompt for Gemini's image *edit* call —
// same lesson as Interior Design's prompt builder: short, front-loaded, and
// explicit about what must stay unchanged is what an image model actually
// follows. Unlike Interior Design, there's no "no photo" branch — the whole
// point of Landscape is redesigning this exact house's actual yard, so a
// photo is always required upstream of this call.
export function buildLandscapePrompt(input: { style: string; layoutDescription: string; notes: string }): string {
  const parts: (string | null)[] = [];

  parts.push(`Redesign the landscaping around this house in a ${input.style} landscape design style.`);

  if (input.layoutDescription) parts.push(input.layoutDescription);

  if (input.notes.trim()) parts.push(input.notes.trim());

  parts.push(
    `Keep the house itself — its architecture, structure, roofline, windows, doors, siding, and materials — and the camera angle completely unchanged. Only change the yard, landscaping, and hardscape around the house.`
  );
  parts.push(`Photorealistic, real estate listing photography quality, natural daylight.`);

  return parts.filter(Boolean).join(" ");
}
