import sharp from "sharp";

// Composes a room's uploaded inspiration photos and material swatches into
// a single grid collage — plain image composition via sharp, deliberately
// NOT an AI-reinterpreted image, so the board always shows exactly what was
// uploaded. See app/api/mood-board/generate/route.ts for the route that
// calls this.

const TILE_SIZE = 440;
const LABEL_HEIGHT = 34;
const GAP = 18;
const PADDING = 28;
const HEADER_HEIGHT = 84;
const MAX_COLS = 4;
// Caps how large one collage can get — a board with more items than this
// still works, just only the first MAX_ITEMS are shown in the generated
// image (every item is still kept and visible in the app's own list).
const MAX_ITEMS = 24;

const COLORS = {
  background: "#F4F7F6",
  headerText: "#123E80",
  labelText: "#1D2B3A",
  inspirationBorder: "#1D63C4",
  materialBorder: "#F0862E",
};

export interface MoodBoardCollageItem {
  url: string;
  type: "inspiration" | "material";
  label: string | null;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function fetchTile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch mood board image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return sharp(buffer).rotate().resize({ width: TILE_SIZE, height: TILE_SIZE, fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
}

export async function composeMoodBoardCollage(title: string, items: MoodBoardCollageItem[]): Promise<Buffer> {
  const capped = items.slice(0, MAX_ITEMS);
  if (capped.length === 0) {
    throw new Error("No items to compose into a mood board yet.");
  }

  const cols = Math.min(MAX_COLS, Math.ceil(Math.sqrt(capped.length)));
  const rows = Math.ceil(capped.length / cols);
  const tileOuterH = TILE_SIZE + LABEL_HEIGHT;

  const canvasWidth = PADDING * 2 + cols * TILE_SIZE + (cols - 1) * GAP;
  const canvasHeight = HEADER_HEIGHT + PADDING * 2 + rows * tileOuterH + (rows - 1) * GAP;

  const tiles = await Promise.all(
    capped.map(async (item, i) => {
      const buffer = await fetchTile(item.url);
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        buffer,
        left: PADDING + col * (TILE_SIZE + GAP),
        top: HEADER_HEIGHT + PADDING + row * (tileOuterH + GAP),
        label: item.label,
        type: item.type,
      };
    })
  );

  const backgroundSvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${COLORS.background}"/>
    <text x="${PADDING}" y="52" font-family="Georgia, serif" font-size="32" font-weight="600" fill="${COLORS.headerText}">${escapeXml(title)}</text>
  </svg>`;

  // A second, transparent SVG layer composited ON TOP of the photo tiles —
  // borders and captions need to render above the photos, not under them.
  const overlaySvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    ${tiles
      .map(
        (t) =>
          `<rect x="${t.left - 2}" y="${t.top - 2}" width="${TILE_SIZE + 4}" height="${TILE_SIZE + 4}" fill="none" stroke="${
            t.type === "material" ? COLORS.materialBorder : COLORS.inspirationBorder
          }" stroke-width="3"/>`
      )
      .join("")}
    ${tiles
      .map((t) =>
        t.label
          ? `<text x="${t.left + TILE_SIZE / 2}" y="${t.top + TILE_SIZE + 24}" font-family="sans-serif" font-size="17" fill="${COLORS.labelText}" text-anchor="middle">${escapeXml(t.label)}</text>`
          : ""
      )
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
