// Draggable fixture/furniture types offered on the Interior Design tab's 2D
// layout editor, keyed by room type (lib/roomTypes.ts). Sizes are rough
// real-world defaults in feet — the user repositions/rotates after
// dropping, this is just a sane starting footprint.
export interface FixtureType {
  id: string;
  label: string;
  width: number;
  depth: number;
  color: string;
}

const KITCHEN: FixtureType[] = [
  { id: "cabinet-base", label: "Base cabinets", width: 4, depth: 2, color: "#8C7A63" },
  { id: "cabinet-wall", label: "Wall cabinets", width: 4, depth: 1, color: "#B8AFA0" },
  { id: "island", label: "Kitchen island", width: 6, depth: 3, color: "#C9822B" },
  { id: "refrigerator", label: "Refrigerator", width: 3, depth: 2.5, color: "#4A4A45" },
  { id: "range", label: "Range", width: 2.5, depth: 2, color: "#3A3A38" },
  { id: "sink-base", label: "Sink base", width: 3, depth: 2, color: "#7A9471" },
  { id: "pantry", label: "Pantry cabinet", width: 2.5, depth: 2, color: "#5E5348" },
];

const BATHROOM: FixtureType[] = [
  { id: "toilet", label: "Toilet", width: 1.5, depth: 2.5, color: "#DCE3E0" },
  { id: "shower", label: "Shower", width: 3, depth: 3, color: "#C9DDE0" },
  { id: "bathtub", label: "Bathtub", width: 5, depth: 2.5, color: "#B0C7CC" },
  { id: "vanity", label: "Vanity/sink", width: 3, depth: 2, color: "#8C7A63" },
  { id: "linen-cabinet", label: "Linen cabinet", width: 1.5, depth: 1.5, color: "#5E5348" },
];

const BEDROOM: FixtureType[] = [
  { id: "bed-queen", label: "Queen bed", width: 5, depth: 6.5, color: "#7A9471" },
  { id: "bed-king", label: "King bed", width: 6.5, depth: 6.5, color: "#7A9471" },
  { id: "dresser", label: "Dresser", width: 4, depth: 1.5, color: "#8C7A63" },
  { id: "nightstand", label: "Nightstand", width: 1.5, depth: 1.5, color: "#5E5348" },
  { id: "closet", label: "Closet", width: 4, depth: 2, color: "#B8AFA0" },
];

const LIVING_ROOM: FixtureType[] = [
  { id: "sofa", label: "Sofa", width: 7, depth: 3, color: "#7A9471" },
  { id: "armchair", label: "Armchair", width: 3, depth: 3, color: "#8C7A63" },
  { id: "coffee-table", label: "Coffee table", width: 4, depth: 2, color: "#5E5348" },
  { id: "tv-console", label: "TV console", width: 5, depth: 1.5, color: "#3A3A38" },
];

const DINING_ROOM: FixtureType[] = [
  { id: "dining-table", label: "Dining table", width: 6, depth: 3.5, color: "#8C7A63" },
  { id: "buffet", label: "Buffet/hutch", width: 5, depth: 1.5, color: "#5E5348" },
];

const CLOSET: FixtureType[] = [
  { id: "shelving", label: "Shelving", width: 3, depth: 1.5, color: "#B8AFA0" },
  { id: "hanging-rod", label: "Hanging rod", width: 4, depth: 1.5, color: "#8C7A63" },
];

const HOME_OFFICE: FixtureType[] = [
  { id: "desk", label: "Desk", width: 5, depth: 2.5, color: "#8C7A63" },
  { id: "bookshelf", label: "Bookshelf", width: 3, depth: 1, color: "#5E5348" },
];

const LAUNDRY: FixtureType[] = [
  { id: "washer-dryer", label: "Washer/dryer", width: 5.5, depth: 2.5, color: "#4A4A45" },
  { id: "utility-sink", label: "Utility sink", width: 2, depth: 2, color: "#7A9471" },
];

const GENERIC: FixtureType[] = [{ id: "furniture", label: "Furniture", width: 3, depth: 2, color: "#8A8580" }];

export const FIXTURE_CATALOG: Record<string, FixtureType[]> = {
  Kitchen: KITCHEN,
  Bathroom: BATHROOM,
  Bedroom: BEDROOM,
  "Primary Bedroom": BEDROOM,
  "Living Room": LIVING_ROOM,
  "Dining Room": DINING_ROOM,
  Closet: CLOSET,
  "Home Office": HOME_OFFICE,
  "Laundry Room": LAUNDRY,
  Entryway: GENERIC,
  Hallway: GENERIC,
  Other: GENERIC,
};

export function getFixturesForRoomType(roomType: string): FixtureType[] {
  return FIXTURE_CATALOG[roomType] ?? GENERIC;
}
