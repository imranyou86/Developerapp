import sharp from "sharp";
import { BOARD_WIDTH, BOARD_HEIGHT, assignDefaultPositions, clamp, type MoodBoardLayoutItem } from "@/lib/moodBoardLayout";
import { textPath } from "@/lib/textPath";

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
//
// Styled after an editorial scrapbook-style moodboard reference the
// person shared: arch/oval photo cuts instead of a uniform grid, a
// hand-drawn-style arrow calling out the materials, a script accent
// (lib/scriptFont.ts — real glyph outlines, not a font-family that may
// not exist wherever this runs), and a dominant-color palette column.
// NOT attempted: true transparent product-cutout photos (the floating
// chair/mirror in the reference) — that needs real background removal
// (subject segmentation), a different capability than this sharp+SVG
// compositor, not just a styling change.

const MARGIN = 32;
const HEADER_HEIGHT = 118;
const TILE_RADIUS = 14;
const PALETTE_WIDTH = 100;
const PALETTE_MAX_SWATCHES = 6;
const ANNOTATION_STRIP = 80;
// Caps how large one collage can get — a board with more items than this
// still works, just only the first MAX_ITEMS are shown in the generated
// image (every item is still kept and visible in the app's own list).
const MAX_ITEMS = 24;

const COLORS = {
  background: "#FAF6F0",
  kicker: "#9A7B52",
  headerText: "#2B2420",
  subtitleScript: "#4A3F33",
  divider: "#E4DACB",
  swatchBg: "#F1E7D8",
  swatchText: "#5C4A2E",
  swatchBorder: "#B9792F",
  annotationInk: "#221B14",
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

type TileShape = "rounded" | "oval" | "arch";

interface PlacedItem {
  item: MoodBoardCollageItem;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RenderedTile {
  buffer: Buffer;
  left: number;
  top: number;
  width: number;
  height: number;
  type: "inspiration" | "material";
  shape: TileShape;
  avgColor: { r: number; g: number; b: number } | null;
  label: string | null;
  hasPhoto: boolean;
}

// Greedy word-wrap for the multi-line label inside a text-only swatch card
// — the label is the whole content there, so it needs to fit on 2-3 lines
// instead of being truncated to one.
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

// The arc occupies exactly the top `ry` of the box (from y to y+ry) and
// the flat sides run the rest of the way down to the bottom — so the
// shape's true bounding box is exactly [x, y, x+2*rx, y+height], with no
// part of the arc overshooting above y. That matters beyond just the
// photo mask (which happens to get away with an overshoot, since the
// mask's own raster canvas is exactly tile-sized and silently clips
// anything outside it): the drop shadow below draws this same path
// un-clipped on the full canvas, where an overshoot would show up as a
// stray crescent above the tile. Explicit rx/ry (not re-derived from a
// padded width/height) let the shadow pass in "this tile's real radii,
// plus pad" and get a shadow that's a true uniform offset of the tile's
// own outline.
function archPathD(x: number, y: number, rx: number, ry: number, height: number): string {
  const archBottom = y + ry;
  const bottom = y + height;
  const x2 = x + rx * 2;
  return `M${x},${bottom} L${x},${archBottom} A${rx},${ry} 0 0 1 ${x2},${archBottom} L${x2},${bottom} Z`;
}

function archRadii(width: number, height: number): { rx: number; ry: number } {
  const rx = width / 2;
  const ry = Math.min(rx, height * 0.55);
  return { rx, ry };
}

function shapeMaskMarkup(shape: TileShape, width: number, height: number): string {
  if (shape === "oval") {
    return `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="#fff"/>`;
  }
  if (shape === "arch") {
    const { rx, ry } = archRadii(width, height);
    return `<path d="${archPathD(0, 0, rx, ry, height)}" fill="#fff"/>`;
  }
  const r = Math.min(TILE_RADIUS, width / 2, height / 2);
  return `<rect width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#fff"/>`;
}

// Photo tiles get their shape from a mask composite (a plain rectangular
// photo can't express an arch or an oval crop on its own); text-only
// swatch cards draw their own rounded rect directly in the SVG they're
// rasterized from, so they don't need this step.
async function maskPhotoTile(buffer: Buffer, width: number, height: number, shape: TileShape): Promise<Buffer> {
  const mask = Buffer.from(`<svg width="${width}" height="${height}">${shapeMaskMarkup(shape, width, height)}</svg>`);
  return sharp(buffer).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

function buildSwatchTileSvg(label: string | null, width: number, height: number): Buffer {
  const fontSize = Math.max(12, Math.min(19, Math.round(width / 11)));
  const maxCharsPerLine = Math.max(6, Math.floor((width - 24) / (fontSize * 0.52)));
  const lines = wrapLabel(label ?? "Material", maxCharsPerLine);
  const lineHeight = fontSize * 1.3;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  const linesMarkup = lines
    .map((line, i) => textPath("serif", line, width / 2, startY + i * lineHeight, fontSize, COLORS.swatchText, "middle").markup)
    .join("");
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" rx="${TILE_RADIUS}" ry="${TILE_RADIUS}" fill="${COLORS.swatchBg}"/>
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${TILE_RADIUS - 1}" ry="${TILE_RADIUS - 1}" fill="none" stroke="${COLORS.swatchBorder}" stroke-opacity="0.35" stroke-width="1.5"/>
    ${linesMarkup}
  </svg>`);
}

// Soft, hand-rolled drop shadow (several stacked, slightly-offset
// translucent shapes matching the tile's own silhouette) instead of an
// SVG blur filter — filter primitive support varies across SVG
// rasterizers, while plain shapes render identically everywhere, and the
// sandbox-verified result reads as a believable soft shadow at this scale.
function buildShadowFragment(shape: TileShape, left: number, top: number, width: number, height: number): string {
  const steps = [
    { pad: 11, opacity: 0.04 },
    { pad: 8, opacity: 0.06 },
    { pad: 5, opacity: 0.08 },
    { pad: 2, opacity: 0.1 },
  ];
  const dy = 5;
  return steps
    .map((s) => {
      if (shape === "oval") {
        const rx = width / 2 + s.pad;
        const ry = height / 2 + s.pad;
        return `<ellipse cx="${left + width / 2}" cy="${top + height / 2 + dy}" rx="${rx}" ry="${ry}" fill="${COLORS.shadow}" opacity="${s.opacity}"/>`;
      }
      if (shape === "arch") {
        const base = archRadii(width, height);
        const rx = base.rx + s.pad;
        const ry = base.ry + s.pad;
        return `<path d="${archPathD(left - s.pad, top - s.pad + dy, rx, ry, height + s.pad * 2)}" fill="${COLORS.shadow}" opacity="${s.opacity}"/>`;
      }
      const r = Math.min(TILE_RADIUS, width / 2, height / 2) + s.pad;
      return `<rect x="${left - s.pad}" y="${top - s.pad + dy}" width="${width + s.pad * 2}" height="${height + s.pad * 2}" rx="${r}" fill="${COLORS.shadow}" opacity="${s.opacity}"/>`;
    })
    .join("");
}

// Rough char-width estimate for a small sans-serif tag — good enough to
// keep a long label from overflowing its little sticker.
function truncateLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  return `${label.slice(0, maxChars - 1).trimEnd()}…`;
}

// A small "swing tag" sticker clipped onto a photo tile's bottom-right
// corner — anchored to the tile's rectangular bounding box rather than
// its masked silhouette, so it sits in the same place regardless of
// whether the tile is an arch, an oval, or a plain rounded rect.
function buildTagFragment(left: number, top: number, width: number, height: number, label: string): string {
  const text = truncateLabel(label, 20);
  const fontSize = 10;
  const tagHeight = 20;
  const padX = 10;
  // Measured against the real bundled font rather than an estimated
  // char-width — the tag can be sized exactly instead of guessed-and-
  // padded.
  const { markup, width: textWidth } = textPath("sans", text, 0, 0, fontSize, COLORS.headerText, "start");
  const tagWidth = Math.min(132, textWidth + padX * 2);
  const px = left + width - tagWidth - 6;
  const py = top + height - tagHeight - 6;
  const textX = px + tagWidth / 2 - textWidth / 2;
  const textY = py + tagHeight / 2 + 3.5;
  return `<g>
    <rect x="${px + 1}" y="${py + 2}" width="${tagWidth}" height="${tagHeight}" rx="${tagHeight / 2}" fill="${COLORS.shadow}" opacity="0.12"/>
    <rect x="${px}" y="${py}" width="${tagWidth}" height="${tagHeight}" rx="${tagHeight / 2}" fill="rgba(255,255,255,0.95)"/>
    <g transform="translate(${textX}, ${textY})">${markup}</g>
  </g>`;
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

// A gentle curved line (not a straight one) with a small sketchy two-stroke
// arrowhead, instead of a rigid arrow marker — the curve bows a fixed
// fraction of its own length perpendicular to its direction, which reads
// as hand-drawn without depending on any font or icon asset.
function buildArrowFragment(x1: number, y1: number, x2: number, y2: number, color: string): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const bow = Math.min(40, len * 0.22);
  const midX = (x1 + x2) / 2 + nx * bow;
  const midY = (y1 + y2) / 2 + ny * bow;
  const headLen = 11;
  const spread = 6;
  const leftX = x2 - ux * headLen - uy * spread;
  const leftY = y2 - uy * headLen + ux * spread;
  const rightX = x2 - ux * headLen + uy * spread;
  const rightY = y2 - uy * headLen - ux * spread;
  return `<path d="M${x1},${y1} Q${midX},${midY} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M${x2},${y2} L${leftX},${leftY} M${x2},${y2} L${rightX},${rightY}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`;
}

export async function composeMoodBoardCollage(header: MoodBoardCollageHeader, rawItems: MoodBoardCollageItem[]): Promise<Buffer> {
  if (rawItems.length === 0) {
    throw new Error("No items to compose into a mood board yet.");
  }
  const capped = rawItems.slice(0, MAX_ITEMS);
  const positioned = assignDefaultPositions(capped);

  const placed: PlacedItem[] = positioned.map((item) => ({
    item,
    left: MARGIN + Math.round(item.x * BOARD_WIDTH),
    top: HEADER_HEIGHT + MARGIN + Math.round(item.y * BOARD_HEIGHT),
    width: Math.max(40, Math.round(item.width * BOARD_WIDTH)),
    height: Math.max(40, Math.round(item.height * BOARD_HEIGHT)),
  }));

  // One signature "arch" tile — the largest inspiration photo, same
  // feature-image role the arch cut plays in the reference — plus an oval
  // cut on every other remaining inspiration photo for variety. Material
  // photos stay plain rounded tiles, same role as the small swatch photos
  // in the reference.
  const inspirationPhotoIdx = placed
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.item.type === "inspiration" && p.item.url);
  const shapes = new Map<number, TileShape>();
  if (inspirationPhotoIdx.length > 0) {
    let archIdx = inspirationPhotoIdx[0].i;
    let archArea = 0;
    for (const { p, i } of inspirationPhotoIdx) {
      const area = p.width * p.height;
      if (area > archArea) {
        archArea = area;
        archIdx = i;
      }
    }
    shapes.set(archIdx, "arch");
    let ovalToggle = false;
    for (const { i } of inspirationPhotoIdx) {
      if (i === archIdx) continue;
      shapes.set(i, ovalToggle ? "rounded" : "oval");
      ovalToggle = !ovalToggle;
    }
  }

  const tiles: RenderedTile[] = await Promise.all(
    placed.map(async ({ item, left, top, width, height }, i) => {
      if (item.url) {
        const shape = shapes.get(i) ?? "rounded";
        const raw = await fetchRawImage(item.url);
        const [resized, avgColor] = await Promise.all([
          sharp(raw).rotate().resize({ width, height, fit: "cover" }).jpeg({ quality: 88 }).toBuffer(),
          averageColor(raw),
        ]);
        const buffer = await maskPhotoTile(resized, width, height, shape);
        return { buffer, left, top, width, height, type: item.type, shape, avgColor, label: item.label, hasPhoto: true };
      }

      const buffer = buildSwatchTileSvg(item.label, width, height);
      return {
        buffer,
        left,
        top,
        width,
        height,
        type: item.type,
        shape: "rounded" as TileShape,
        avgColor: null,
        label: item.label,
        hasPhoto: false,
      };
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

  // A hand-drawn-style arrow calling out the materials — pointing from a
  // script "Materials" label up at whichever material item (photo or
  // text swatch) sits highest on the board, same device the reference
  // uses for "Furnitures". Skipped entirely when the board has no
  // material items yet, rather than pointing at nothing.
  const materialTiles = tiles.filter((t) => t.type === "material");
  const hasAnnotation = materialTiles.length > 0;
  let annotationTarget: RenderedTile | null = null;
  if (hasAnnotation) {
    annotationTarget = materialTiles.reduce((best, t) => (t.top < best.top || (t.top === best.top && t.left < best.left) ? t : best));
  }

  const boardAreaWidth = BOARD_WIDTH + PALETTE_WIDTH;
  const canvasWidth = boardAreaWidth + MARGIN * 2;
  const canvasHeight = HEADER_HEIGHT + BOARD_HEIGHT + MARGIN * 2 + (hasAnnotation ? ANNOTATION_STRIP : 0);

  const headerTitleY = header.projectName ? 76 : 80;
  const headerSubtitleY = headerTitleY + 30;

  const paletteCx = MARGIN + boardAreaWidth - PALETTE_WIDTH / 2;
  const paletteRadius = 17;
  const paletteGap = 42;
  const paletteTotalHeight = paletteColors.length > 0 ? (paletteColors.length - 1) * paletteGap : 0;
  const paletteStartY = HEADER_HEIGHT + MARGIN + (BOARD_HEIGHT - paletteTotalHeight) / 2;

  const paletteSvg = paletteColors
    .map((c, i) => {
      const cy = paletteStartY + i * paletteGap;
      const fill = `rgb(${c.r}, ${c.g}, ${c.b})`;
      return `${buildCircleShadowFragment(paletteCx, cy, paletteRadius)}
        <circle cx="${paletteCx}" cy="${cy}" r="${paletteRadius}" fill="${fill}"/>
        <circle cx="${paletteCx}" cy="${cy}" r="${paletteRadius}" fill="none" stroke="#FFFFFF" stroke-width="2"/>`;
    })
    .join("");

  let annotationSvg = "";
  if (hasAnnotation && annotationTarget) {
    const labelY = HEADER_HEIGHT + MARGIN + BOARD_HEIGHT + 52;
    const { markup, width: labelWidth } = textPath("script", "Materials", MARGIN, labelY, 38, COLORS.annotationInk, "start");
    const startX = MARGIN + labelWidth + 14;
    const startY = labelY - 14;
    const endX = clamp(annotationTarget.left + annotationTarget.width / 2, annotationTarget.left + 12, annotationTarget.left + annotationTarget.width - 12);
    const endY = annotationTarget.top + annotationTarget.height - 6;
    annotationSvg = `${markup}${buildArrowFragment(startX, startY, endX, endY, COLORS.annotationInk)}`;
  }

  const subtitle = header.projectName ? textPath("script", header.projectName, MARGIN, headerSubtitleY, 22, COLORS.subtitleScript, "start") : null;
  const kicker = textPath("sans", "MOOD BOARD", MARGIN, 32, 11, COLORS.kicker, "start", 3);
  const title = textPath("serif", header.roomName.toUpperCase(), MARGIN, headerTitleY, 32, COLORS.headerText, "start");

  const backgroundSvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${COLORS.background}"/>
    ${kicker.markup}
    ${title.markup}
    ${subtitle ? subtitle.markup : ""}
    <line x1="${MARGIN}" y1="${HEADER_HEIGHT - 16}" x2="${canvasWidth - MARGIN}" y2="${HEADER_HEIGHT - 16}" stroke="${COLORS.divider}" stroke-width="1"/>
    ${tiles.map((t) => buildShadowFragment(t.shape, t.left, t.top, t.width, t.height)).join("")}
    ${paletteSvg}
    ${annotationSvg}
  </svg>`;

  // A small "swing tag" on each labeled photo tile — composited ON TOP of
  // the photos, in its own layer, since it needs to sit above whichever
  // tile it's tagging regardless of paint order. Anchored to the tile's
  // rectangular bounding box (see buildTagFragment), so it works the same
  // way for an arch, an oval, or a plain rounded tile. Swatch cards already
  // show their label as their whole content, so they don't get a tag.
  const overlaySvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    ${tiles
      .filter((t) => t.hasPhoto && t.label)
      .map((t) => buildTagFragment(t.left, t.top, t.width, t.height, t.label as string))
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
