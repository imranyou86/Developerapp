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
//
// A material item can be a photo OR a plain text label with no photo at
// all (url: null) — "Find materials in this photo" lists components by
// name rather than cropping them out, see app/api/claude/detect-mood-
// board-components. A text-only item renders as a soft labeled card in
// place of a photo tile, same rounded-corner/shadow treatment as a photo
// so the board still reads as one cohesive layout either way.

const MARGIN = 32;
const HEADER_HEIGHT = 118;
const TILE_RADIUS = 14;
const PALETTE_WIDTH = 100;
const PALETTE_MAX_SWATCHES = 6;
// Caps how large one collage can get — a board with more items than this
// still works, just only the first MAX_ITEMS are shown in the generated
// image (every item is still kept and visible in the app's own list).
const MAX_ITEMS = 24;

const COLORS = {
  background: "#FAF6F0",
  kicker: "#9A7B52",
  headerText: "#2B2420",
  subtitle: "#7A7066",
  divider: "#E4DACB",
  swatchBg: "#F1E7D8",
  swatchText: "#5C4A2E",
  pillBg: "rgba(255, 255, 255, 0.92)",
  pillInspiration: "#2F5D8A",
  pillMaterial: "#B9792F",
  labelStrip: "rgba(32, 26, 20, 0.6)",
  labelText: "#FFFFFF",
  shadow: "#140F0A",
};

export interface MoodBoardCollageHeader {
  roomName: string;
  projectName?: string | null;
}

export interface MoodBoardCollageItem extends MoodBoardLayoutItem {
  url: string | null;
  type: "inspiration" | "material";
  label: string | null;
}

interface RenderedTile {
  buffer: Buffer;
  left: number;
  top: number;
  width: number;
  height: number;
  label: string | null;
  type: "inspiration" | "material";
  hasPhoto: boolean;
  avgColor: { r: number; g: number; b: number } | null;
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

// Greedy word-wrap for the multi-line label inside a text-only swatch card
// — the label is the whole content there (no caption strip to overflow),
// so it needs to fit on 2-3 lines instead of being truncated to one.
function wrapLabel(label: string, maxCharsPerLine: number, maxLines = 3): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length === maxLines - 1) break;
  }
  if (current) lines.push(current);
  const consumedWords = lines.join(" ").split(/\s+/).length;
  if (lines.length === maxLines && consumedWords < words.length) {
    const lastLine = lines[maxLines - 1];
    lines[maxLines - 1] = lastLine.length > maxCharsPerLine - 1 ? `${lastLine.slice(0, maxCharsPerLine - 1).trimEnd()}…` : `${lastLine}…`;
  }
  return lines;
}

async function fetchRawImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch mood board image: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function averageColor(raw: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data } = await sharp(raw).rotate().resize(4, 4, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0,
    g = 0,
    b = 0;
  const pixelCount = data.length / 3;
  for (let i = 0; i < data.length; i += 3) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return { r: Math.round(r / pixelCount), g: Math.round(g / pixelCount), b: Math.round(b / pixelCount) };
}

// Photo tiles get their rounded corners from a soft-mask composite (a
// plain rectangular photo can't express a border-radius on its own);
// text-only swatch cards draw their own rounded rect directly in the SVG
// they're rasterized from, so they don't need this step.
async function roundPhotoCorners(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${TILE_RADIUS}" ry="${TILE_RADIUS}" fill="#fff"/></svg>`
  );
  return sharp(buffer).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

function buildSwatchTileSvg(label: string | null, width: number, height: number): Buffer {
  const fontSize = Math.max(12, Math.min(19, Math.round(width / 11)));
  const maxCharsPerLine = Math.max(6, Math.floor((width - 24) / (fontSize * 0.52)));
  const lines = wrapLabel(label ?? "Material", maxCharsPerLine);
  const lineHeight = fontSize * 1.3;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map((line, i) => `<tspan x="${width / 2}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" rx="${TILE_RADIUS}" ry="${TILE_RADIUS}" fill="${COLORS.swatchBg}"/>
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${TILE_RADIUS - 1}" ry="${TILE_RADIUS - 1}" fill="none" stroke="${COLORS.pillMaterial}" stroke-opacity="0.35" stroke-width="1.5"/>
    <text font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${fontSize}" fill="${COLORS.swatchText}" text-anchor="middle">${tspans}</text>
  </svg>`);
}

// Soft, hand-rolled drop shadow (several stacked, slightly-offset
// translucent rounded rects) instead of an SVG blur filter — filter
// primitive support varies across SVG rasterizers, while plain shapes
// render identically everywhere, and the sandbox-verified result reads as
// a believable soft shadow at this scale.
function buildShadowFragment(left: number, top: number, width: number, height: number): string {
  const steps = [
    { pad: 11, opacity: 0.04 },
    { pad: 8, opacity: 0.06 },
    { pad: 5, opacity: 0.08 },
    { pad: 2, opacity: 0.1 },
  ];
  const dy = 5;
  return steps
    .map(
      (s) =>
        `<rect x="${left - s.pad}" y="${top - s.pad + dy}" width="${width + s.pad * 2}" height="${height + s.pad * 2}" rx="${TILE_RADIUS + s.pad}" fill="${COLORS.shadow}" opacity="${s.opacity}"/>`
    )
    .join("");
}

function buildCircleShadowFragment(cx: number, cy: number, radius: number): string {
  const steps = [
    { pad: 8, opacity: 0.05 },
    { pad: 5, opacity: 0.08 },
    { pad: 2, opacity: 0.11 },
  ];
  const dy = 4;
  return steps.map((s) => `<circle cx="${cx}" cy="${cy + dy}" r="${radius + s.pad}" fill="${COLORS.shadow}" opacity="${s.opacity}"/>`).join("");
}

function buildPillFragment(left: number, top: number, type: "inspiration" | "material"): string {
  const label = type === "material" ? "MATERIAL" : "INSPIRATION";
  const dotColor = type === "material" ? COLORS.pillMaterial : COLORS.pillInspiration;
  const pillWidth = 20 + label.length * 6.2;
  const px = left + 10;
  const py = top + 10;
  return `<g>
    <rect x="${px}" y="${py}" width="${pillWidth}" height="20" rx="10" fill="${COLORS.pillBg}"/>
    <circle cx="${px + 11}" cy="${py + 10}" r="4" fill="${dotColor}"/>
    <text x="${px + 20}" y="${py + 14}" font-family="sans-serif" font-size="9" font-weight="700" letter-spacing="0.5" fill="${dotColor}">${label}</text>
  </g>`;
}

export async function composeMoodBoardCollage(header: MoodBoardCollageHeader, rawItems: MoodBoardCollageItem[]): Promise<Buffer> {
  if (rawItems.length === 0) {
    throw new Error("No items to compose into a mood board yet.");
  }
  const capped = rawItems.slice(0, MAX_ITEMS);
  const items = assignDefaultPositions(capped);

  const boardAreaWidth = BOARD_WIDTH + PALETTE_WIDTH;
  const canvasWidth = boardAreaWidth + MARGIN * 2;
  const canvasHeight = HEADER_HEIGHT + BOARD_HEIGHT + MARGIN * 2;

  const tiles: RenderedTile[] = await Promise.all(
    items.map(async (item) => {
      const left = MARGIN + Math.round(item.x * BOARD_WIDTH);
      const top = HEADER_HEIGHT + MARGIN + Math.round(item.y * BOARD_HEIGHT);
      const width = Math.max(40, Math.round(item.width * BOARD_WIDTH));
      const height = Math.max(40, Math.round(item.height * BOARD_HEIGHT));

      if (item.url) {
        const raw = await fetchRawImage(item.url);
        const [resized, avgColor] = await Promise.all([
          sharp(raw).rotate().resize({ width, height, fit: "cover" }).jpeg({ quality: 88 }).toBuffer(),
          averageColor(raw),
        ]);
        const buffer = await roundPhotoCorners(resized, width, height);
        return { buffer, left, top, width, height, label: item.label, type: item.type, hasPhoto: true, avgColor };
      }

      const buffer = buildSwatchTileSvg(item.label, width, height);
      return { buffer, left, top, width, height, label: item.label, type: item.type, hasPhoto: false, avgColor: null };
    })
  );

  // One palette swatch per photo (sampled by its average color) — picked
  // evenly across the board rather than just the first few, so the column
  // reflects the whole board, not just whatever happened to load first.
  const photoTiles = tiles.filter((t) => t.avgColor);
  const paletteColors: { r: number; g: number; b: number }[] = [];
  if (photoTiles.length > 0) {
    const count = Math.min(PALETTE_MAX_SWATCHES, photoTiles.length);
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i * (photoTiles.length - 1)) / Math.max(1, count - 1));
      const color = photoTiles[idx].avgColor;
      if (color) paletteColors.push(color);
    }
  }

  const headerTitleY = header.projectName ? 76 : 80;
  const headerSubtitleY = headerTitleY + 24;

  const paletteCx = MARGIN + boardAreaWidth - PALETTE_WIDTH / 2;
  const paletteRadius = 17;
  const paletteGap = 42;
  const paletteTotalHeight = paletteColors.length > 0 ? (paletteColors.length - 1) * paletteGap : 0;
  const paletteStartY = HEADER_HEIGHT + MARGIN + (BOARD_HEIGHT - paletteTotalHeight) / 2;

  const paletteSvg =
    paletteColors.length > 0
      ? `<text x="${paletteCx}" y="${paletteStartY - paletteRadius - 16}" font-family="sans-serif" font-size="10" font-weight="700" letter-spacing="2" fill="${COLORS.kicker}" text-anchor="middle">PALETTE</text>
      ${paletteColors
        .map((c, i) => {
          const cy = paletteStartY + i * paletteGap;
          const fill = `rgb(${c.r}, ${c.g}, ${c.b})`;
          return `${buildCircleShadowFragment(paletteCx, cy, paletteRadius)}
            <circle cx="${paletteCx}" cy="${cy}" r="${paletteRadius}" fill="${fill}"/>
            <circle cx="${paletteCx}" cy="${cy}" r="${paletteRadius}" fill="none" stroke="#FFFFFF" stroke-width="2"/>`;
        })
        .join("")}`
      : "";

  const backgroundSvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${COLORS.background}"/>
    <text x="${MARGIN}" y="32" font-family="sans-serif" font-size="11" font-weight="700" letter-spacing="3" fill="${COLORS.kicker}">MOOD BOARD</text>
    <text x="${MARGIN}" y="${headerTitleY}" font-family="Georgia, 'Times New Roman', serif" font-size="32" font-weight="700" fill="${COLORS.headerText}">${escapeXml(header.roomName.toUpperCase())}</text>
    ${
      header.projectName
        ? `<text x="${MARGIN}" y="${headerSubtitleY}" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="15" fill="${COLORS.subtitle}">${escapeXml(header.projectName)}</text>`
        : ""
    }
    <line x1="${MARGIN}" y1="${HEADER_HEIGHT - 16}" x2="${canvasWidth - MARGIN}" y2="${HEADER_HEIGHT - 16}" stroke="${COLORS.divider}" stroke-width="1"/>
    ${tiles.map((t) => buildShadowFragment(t.left, t.top, t.width, t.height)).join("")}
    ${paletteSvg}
  </svg>`;

  // A second, transparent SVG layer composited ON TOP of the photo tiles —
  // the type pill and caption need to render above the photos, not under
  // them. Captions sit inside each tile's own bottom strip (not below the
  // tile) so they can never overlap a neighboring tile regardless of how
  // tightly the board's been arranged. Swatch cards already carry their
  // label as their whole content, so they skip both.
  const overlaySvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    ${tiles
      .filter((t) => t.hasPhoto)
      .map((t) => buildPillFragment(t.left, t.top, t.type))
      .join("")}
    ${tiles
      .filter((t) => t.hasPhoto && t.label)
      .map((t) => {
        const stripHeight = Math.min(26, t.height * 0.3);
        return `<rect x="${t.left}" y="${t.top + t.height - stripHeight}" width="${t.width}" height="${stripHeight}" fill="${COLORS.labelStrip}"/>
          <text x="${t.left + t.width / 2}" y="${t.top + t.height - stripHeight / 2 + 5}" font-family="sans-serif" font-size="14" fill="${COLORS.labelText}" text-anchor="middle">${escapeXml(truncateLabel(t.label as string, t.width))}</text>`;
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
