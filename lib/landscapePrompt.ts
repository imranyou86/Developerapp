import type { LandscapeComponentSelection } from "@/lib/types";

// Fixed starter checklist rather than a free-for-all list — grass, decks,
// pools, and concrete/hardscape work cover the common asks; "Other" below
// the checklist (the notes field) covers anything not on it without forcing
// every possible landscape feature into its own checkbox.
export const LANDSCAPE_COMPONENTS: { id: string; label: string }[] = [
  { id: "grass", label: "Grass / Lawn" },
  { id: "deck", label: "Deck" },
  { id: "pool", label: "Pool" },
  { id: "concrete", label: "Concrete / Patio work" },
];

export const LANDSCAPE_STYLES = ["Modern Minimalist", "Mediterranean", "Desert / Drought-Tolerant", "Tropical", "Traditional Lawn"];

// Deterministic, template-built prompt for OpenAI's image *edit* endpoint —
// same lesson as Interior Design's prompt builder: short, front-loaded, and
// explicit about what must stay unchanged is what an image model actually
// follows. Unlike Interior Design, there's no "no photo" branch — the whole
// point of Landscape is redesigning this exact house's actual yard, so a
// photo is always required upstream of this call.
export function buildLandscapePrompt(input: {
  style: string;
  components: LandscapeComponentSelection[];
  notes: string;
}): string {
  const parts: (string | null)[] = [];

  parts.push(`Redesign the landscaping around this house in a ${input.style} landscape design style.`);

  if (input.components.length > 0) {
    const lines = input.components.map((c, i) => `${i + 1}. ${c.label}${c.detail.trim() ? ` — ${c.detail.trim()}` : ""}`);
    parts.push(
      `LANDSCAPE FEATURES — add exactly these, and no other major hardscape or landscape elements beyond them:\n${lines.join("\n")}`
    );
  }

  if (input.notes.trim()) parts.push(input.notes.trim());

  parts.push(
    `Keep the house itself — its architecture, structure, roofline, windows, doors, siding, and materials — and the camera angle completely unchanged. Only change the yard, landscaping, and hardscape around the house.`
  );
  parts.push(`Photorealistic, real estate listing photography quality, natural daylight.`);

  return parts.filter(Boolean).join(" ");
}
