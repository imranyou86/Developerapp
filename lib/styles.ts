import type { StyleName } from "@/lib/types";

export interface StylePalette {
  name: StyleName;
  colors: string[];
  wall: string;
  floor: string;
  accent: string;
  description: string;
}

// Starting points, not a locked list — the Rooms tab's style search offers
// these as autocomplete suggestions and a default color swatch, but someone
// can type any style name and pick their own wall/floor/accent colors
// instead. Interior Design's style field uses these the same way, as
// quick-fill shortcuts on top of its own free-text input.
export const STYLE_PALETTES: StylePalette[] = [
  {
    name: "Warm Modern Minimalist",
    colors: ["#EDE7DD", "#C9822B", "#3A3A38", "#B8AFA0"],
    wall: "#EDE7DD",
    floor: "#B8AFA0",
    accent: "#C9822B",
    description: "Clean lines, warm neutrals, a single amber accent, and negative space that lets materials breathe.",
  },
  {
    name: "Modern Farmhouse",
    colors: ["#F5F1E8", "#2E4756", "#8C7A63", "#FFFFFF"],
    wall: "#F5F1E8",
    floor: "#8C7A63",
    accent: "#2E4756",
    description: "Shiplap-white walls, black-framed windows, natural wood tones, and simple farmhouse silhouettes.",
  },
  {
    name: "Scandinavian",
    colors: ["#FAFAF7", "#DCE3E0", "#C9822B", "#4A4A45"],
    wall: "#FAFAF7",
    floor: "#DCE3E0",
    accent: "#C9822B",
    description: "Light woods, soft whites, and functional furniture with just enough warmth to avoid feeling cold.",
  },
  {
    name: "Industrial Loft",
    colors: ["#3A3A38", "#8A8580", "#B0492F", "#1F1F1D"],
    wall: "#3A3A38",
    floor: "#1F1F1D",
    accent: "#B0492F",
    description: "Exposed structure, dark palettes, raw materials, and metal-and-wood furniture silhouettes.",
  },
  {
    name: "Transitional Classic",
    colors: ["#F0ECE3", "#7A9471", "#5E5348", "#C9822B"],
    wall: "#F0ECE3",
    floor: "#5E5348",
    accent: "#7A9471",
    description: "A balance of traditional millwork and clean modern forms, in a timeless neutral-with-sage palette.",
  },
];

