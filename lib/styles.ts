import type { StyleName } from "@/lib/types";

// Shape used by lib/illustration.ts's buildRoomIllustration — style is now
// pure free text everywhere (no preset list), so this interface just
// describes the wall/floor/accent colors someone picks for a given style
// name, not a fixed catalog of them.
export interface StylePalette {
  name: StyleName;
  colors: string[];
  wall: string;
  floor: string;
  accent: string;
  description: string;
}

// Sane starting colors for a brand-new style entry's color pickers — not a
// preset to choose from, just a default so the pickers aren't blank.
export const DEFAULT_PALETTE_COLORS = {
  wall: "#EDE7DD",
  floor: "#B8AFA0",
  accent: "#C9822B",
};
