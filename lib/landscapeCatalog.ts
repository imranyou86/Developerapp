import type { FixtureType } from "@/lib/fixtureCatalog";

// Draggable landscape elements offered on the Landscape tab's 2D yard layout
// editor — the same FixtureType shape as lib/fixtureCatalog.ts's room
// fixtures, reused as-is by the generalized layout editor. Sizes are rough
// real-world default footprints in feet; the user repositions/resizes/
// rotates after dropping.
export const LANDSCAPE_CATALOG: FixtureType[] = [
  { id: "pool", label: "Pool", width: 16, depth: 32, color: "#5FA8C9" },
  { id: "spa", label: "Spa/hot tub", width: 6, depth: 6, color: "#4C93B5" },
  { id: "deck", label: "Deck", width: 12, depth: 10, color: "#A8825A" },
  { id: "patio", label: "Patio", width: 14, depth: 12, color: "#B0AAA0" },
  { id: "walkway", label: "Walkway", width: 3, depth: 12, color: "#C9C2B4" },
  { id: "lawn", label: "Lawn area", width: 20, depth: 15, color: "#7A9471" },
  { id: "planting-bed", label: "Planting bed", width: 8, depth: 3, color: "#5E7248" },
  { id: "fire-pit", label: "Fire pit", width: 5, depth: 5, color: "#6B5645" },
  { id: "outdoor-kitchen", label: "Outdoor kitchen", width: 8, depth: 3, color: "#4A4A45" },
  { id: "pergola", label: "Pergola", width: 10, depth: 10, color: "#8C7A63" },
  { id: "fence-line", label: "Fence line", width: 20, depth: 0.5, color: "#8A8580" },
  { id: "retaining-wall", label: "Retaining wall", width: 15, depth: 1, color: "#7C7264" },
  { id: "shed", label: "Shed", width: 8, depth: 8, color: "#5E5348" },
];
