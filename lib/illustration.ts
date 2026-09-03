import type { StylePalette } from "@/lib/styles";

// Furniture silhouettes are picked by room type/name — this is a lightweight
// keyword match, not an exhaustive taxonomy.
function furnitureFor(roomName: string, wall: string, floor: string, accent: string): string {
  const n = roomName.toLowerCase();

  if (n.includes("bed")) {
    return `
      <rect x="40" y="150" width="130" height="80" rx="6" fill="${accent}" opacity="0.85" />
      <rect x="40" y="140" width="130" height="20" rx="4" fill="${accent}" />
      <rect x="200" y="120" width="40" height="40" rx="4" fill="${floor}" opacity="0.6" />`;
  }
  if (n.includes("bath")) {
    return `
      <rect x="220" y="150" width="70" height="45" rx="10" fill="#FFFFFF" stroke="${accent}" stroke-width="2" />
      <rect x="40" y="170" width="90" height="35" rx="6" fill="#FFFFFF" stroke="${accent}" stroke-width="2" />
      <circle cx="85" cy="170" r="10" fill="${accent}" opacity="0.6" />`;
  }
  if (n.includes("kitchen")) {
    return `
      <rect x="30" y="180" width="260" height="40" rx="4" fill="${accent}" opacity="0.85" />
      <rect x="150" y="150" width="60" height="30" rx="3" fill="#FFFFFF" stroke="${accent}" stroke-width="2" />
      <circle cx="180" cy="165" r="10" fill="${floor}" opacity="0.5" />`;
  }
  if (n.includes("living") || n.includes("family")) {
    return `
      <rect x="50" y="160" width="150" height="55" rx="10" fill="${accent}" opacity="0.85" />
      <rect x="220" y="150" width="50" height="65" rx="6" fill="${floor}" opacity="0.7" />
      <rect x="110" y="205" width="60" height="20" rx="4" fill="#FFFFFF" opacity="0.5" />`;
  }
  if (n.includes("garage")) {
    return `
      <rect x="30" y="190" width="260" height="6" fill="${accent}" opacity="0.5" />
      <rect x="60" y="150" width="90" height="40" rx="4" fill="${floor}" opacity="0.6" />`;
  }
  if (n.includes("closet") || n.includes("laundry") || n.includes("mechanical") || n.includes("utility")) {
    return `
      <rect x="50" y="120" width="200" height="8" fill="${accent}" />
      <rect x="60" y="130" width="30" height="70" rx="3" fill="#FFFFFF" opacity="0.6" />
      <rect x="100" y="130" width="30" height="70" rx="3" fill="#FFFFFF" opacity="0.6" />
      <rect x="140" y="130" width="30" height="70" rx="3" fill="#FFFFFF" opacity="0.6" />`;
  }
  if (n.includes("office") || n.includes("study")) {
    return `
      <rect x="60" y="170" width="120" height="45" rx="4" fill="${accent}" opacity="0.85" />
      <rect x="90" y="140" width="60" height="30" rx="3" fill="#FFFFFF" opacity="0.6" />`;
  }
  if (n.includes("dining")) {
    return `
      <ellipse cx="160" cy="180" rx="70" ry="30" fill="${accent}" opacity="0.85" />
      <circle cx="110" cy="150" r="10" fill="${floor}" opacity="0.6" />
      <circle cx="210" cy="150" r="10" fill="${floor}" opacity="0.6" />
      <circle cx="110" cy="210" r="10" fill="${floor}" opacity="0.6" />
      <circle cx="210" cy="210" r="10" fill="${floor}" opacity="0.6" />`;
  }

  return `
    <rect x="60" y="160" width="100" height="50" rx="8" fill="${accent}" opacity="0.7" />
    <rect x="190" y="150" width="50" height="60" rx="6" fill="${floor}" opacity="0.6" />`;
}

// Builds a flat "shoebox" illustration entirely on the client — no AI call.
export function buildRoomIllustration(roomName: string, palette: StylePalette): string {
  const { wall, floor, accent } = palette;
  const furniture = furnitureFor(roomName, wall, floor, accent);

  return `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${roomName} illustration">
    <rect width="320" height="240" fill="${wall}" />
    <rect y="130" width="320" height="110" fill="${floor}" />
    <rect x="0" y="126" width="320" height="6" fill="#00000022" />
    <rect x="230" y="30" width="70" height="70" rx="4" fill="#FFFFFF" stroke="${accent}" stroke-width="3" />
    <line x1="265" y1="30" x2="265" y2="100" stroke="${accent}" stroke-width="2" />
    <line x1="230" y1="65" x2="300" y2="65" stroke="${accent}" stroke-width="2" />
    ${furniture}
  </svg>`;
}
