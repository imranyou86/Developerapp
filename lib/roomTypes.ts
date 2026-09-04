// Curated room types offered on the Interior Design tab — a broader,
// design-facing list than detect-rooms' structural vocabulary (which also
// includes non-design spaces like "Mechanical"/"Garage").
export const ROOM_TYPES = [
  "Bedroom",
  "Primary Bedroom",
  "Bathroom",
  "Kitchen",
  "Living Room",
  "Dining Room",
  "Closet",
  "Home Office",
  "Laundry Room",
  "Entryway",
  "Hallway",
  "Other",
] as const;

export type RoomTypeOption = (typeof ROOM_TYPES)[number];

// Best-effort match of a free-text room type (e.g. from the Rooms tab's
// AI-detected `rooms.type`) onto our curated list, for pre-filling the
// Interior Design form when a user picks an existing room.
export function matchRoomType(freeText: string | null): RoomTypeOption {
  if (!freeText) return "Other";
  const found = ROOM_TYPES.find((t) => t.toLowerCase() === freeText.trim().toLowerCase());
  return found ?? "Other";
}
