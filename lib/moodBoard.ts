import sharp from "sharp";
import { BOARD_WIDTH, BOARD_HEIGHT, assignDefaultPositions, type MoodBoardLayoutItem } from "@/lib/moodBoardLayout";

// Composes a room's uploaded inspiration photos and material swatches into
// a single collage image — plain image composition via sharp, deliberately
// NOT an AI-reinterpreted image, so the board always shows exactly what was
// uploaded. See app/api/mood-board/generate/route.ts for the route that
// calls this.
//
// Every item is positioned from its own x/y/width/height (fractions of the
// shared BOARD_WIDTH x BOARD_HEIGHT canvas — see lib/moodBoardLayout.ts),
// the same values components/MoodBoardCanvas.tsx lets the person drag and
// resize, so the export always matches what's shown on screen. An item
// missing a position (a board that's never been opened and arranged) is
// auto-placed into a grid via assignDefaultPositions — the same fallback
// the canvas itself uses to seed a first-time layout.

const MARGIN = 28;
const HEADER_HEIGHT = 84;
// Caps how large one collage can get — a board with more items than this
// still works, just only the first MAX_ITEMS are shown in the generated
// image (every item is still kept and visible in the app's own list).
const MAX_ITEMS = 24;

const COLORS = {
  background: "#F4F7F6",
  headerText: "#123E80",
  inspirationBorder: "#1D63C4",
  materialBorder: "#F0862E",
  labelStrip: "rgba(18, 28, 45, 0.65)",
  labelText: "#FFFFFF",
};

export interface MoodBoardCollageHeader {
  roomName: string;
  projectName?: string | null;
}

export interface MoodBoardCollageItem extends MoodBoardLayoutItem {
  url: string;
  type: "inspiration" | "material";
  label: string | null;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Rough char-width estimate for 14px sans-serif — good enough to keep a
// long label from overflowing a small freeform tile's caption strip; no
// need for exact text metrics here.
function truncateLabel(label: string, tileWidthPx: number): string {
  const maxChars = Math.max(3, Math.floor((tileWidthPx - 16) / 7.5));
  if (label.length <= maxChars) return label;
  return `${label.slice(0, maxChars - 1).trimEnd()}…`;
}

async function fetchTile(url: string, width: number, height: number): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch mood board image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return sharp(buffer).rotate().resize({ width, height, fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
}

export async function composeMoodBoardCollage(header: MoodBoardCollageHeader, rawItems: MoodBoardCollageItem[]): Promise<Buffer> {
  if (rawItems.length === 0) {
    throw new Error("No items to compose into a mood board yet.");
  }
  const capped = rawItems.slice(0, MAX_ITEMS);
  const items = assignDefaultPositions(capped);

  const canvasWidth = BOARD_WIDTH + MARGIN * 2;
  const canvasHeight = HEADER_HEIGHT + BOARD_HEIGHT + MARGIN * 2;

  const tiles = await Promise.all(
    items.map(async (item) => {
      const left = MARGIN + Math.round(item.x * BOARD_WIDTH);
      const top = HEADER_HEIGHT + MARGIN + Math.round(item.y * BOARD_HEIGHT);
      const width = Math.max(40, Math.round(item.width * BOARD_WIDTH));
      const height = Math.max(40, Math.round(item.height * BOARD_HEIGHT));
      const buffer = await fetchTile(item.url, width, height);
      return { buffer, left, top, width, height, label: item.label, type: item.type };
    })
  );

  const backgroundSvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${COLORS.background}"/>
    <text x="${MARGIN}" y="48" font-family="Georgia, serif" font-size="30" font-weight="600" fill="${COLORS.headerText}">${escapeXml(header.roomName)}</text>
    ${
      header.projectName
        ? `<text x="${MARGIN}" y="72" font-family="sans-serif" font-size="15" fill="#5b6470">${escapeXml(header.projectName)}</text>`
        : ""
    }
  </svg>`;

  // A second, transparent SVG layer composited ON TOP of the photo tiles —
  // borders and captions need to render above the photos, not under them.
  // Captions sit inside each tile's own bottom strip (not below the tile)
  // so they can never overlap a neighboring tile regardless of how tightly
  // the board's been arranged.
  const overlaySvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    ${tiles
      .map(
        (t) =>
          `<rect x="${t.left - 2}" y="${t.top - 2}" width="${t.width + 4}" height="${t.height + 4}" fill="none" stroke="${
            t.type === "material" ? COLORS.materialBorder : COLORS.inspirationBorder
          }" stroke-width="3"/>`
      )
      .join("")}
    ${tiles
      .map((t) => {
        if (!t.label) return "";
        const stripHeight = Math.min(26, t.height * 0.3);
        return `<rect x="${t.left}" y="${t.top + t.height - stripHeight}" width="${t.width}" height="${stripHeight}" fill="${COLORS.labelStrip}"/>
          <text x="${t.left + t.width / 2}" y="${t.top + t.height - stripHeight / 2 + 5}" font-family="sans-serif" font-size="14" fill="${COLORS.labelText}" text-anchor="middle">${escapeXml(truncateLabel(t.label, t.width))}</text>`;
      })
      .join("")}
  </svg>`;

  return sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 3, background: COLORS.background },
  })
    .composite([
      { input: Buffer.from(backgroundSvg), top: 0, left: 0 },
      ...tiles.map((t) => ({ input: t.buffer, top: t.top, left: t.left })),
      { input: Buffer.from(overlaySvg), top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
}
