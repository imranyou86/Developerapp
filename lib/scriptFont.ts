import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";

// The mood board collage (lib/moodBoard.ts) wants one genuinely
// script/handwritten element — matching a reference the person wants to
// get closer to — but `<text font-family="SomeScriptFont">` isn't
// reliable here: a plain CSS `@font-face { src: url(data:...) }` embed was
// tested directly against this app's sharp/librsvg SVG rasterizer and was
// silently ignored (falls back to a generic sans-serif, no error). Fonts
// available to librsvg also aren't guaranteed to match between this
// sandbox and wherever this app is actually deployed.
//
// Converting the text to its actual glyph OUTLINES ourselves (via
// opentype.js, in plain JS, no system font lookup involved) and emitting
// an SVG <path> sidesteps all of that — it's just vector geometry by the
// time it reaches the rasterizer, so it renders identically everywhere.
// Bundled font: Caveat Bold (SIL Open Font License, lib/fonts/Caveat-OFL.txt).

let cachedFont: opentype.Font | null | undefined;

function loadFont(): opentype.Font | null {
  if (cachedFont !== undefined) return cachedFont;
  try {
    const buf = fs.readFileSync(path.join(process.cwd(), "lib", "fonts", "Caveat-Bold.ttf"));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    cachedFont = opentype.parse(arrayBuffer);
  } catch (err) {
    console.error("Could not load the bundled script font, falling back to a plain italic label:", err);
    cachedFont = null;
  }
  return cachedFont;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export interface ScriptTextResult {
  markup: string;
  width: number;
}

// `x` is the LEFT edge the text starts from regardless of anchor — for
// "middle"/"end" the caller gets the actual rendered width back to do
// their own layout math (arrow start points, centering) rather than this
// function guessing what they need.
export function scriptText(text: string, x: number, y: number, fontSize: number, fill: string, anchor: "start" | "middle" | "end" = "start"): ScriptTextResult {
  const font = loadFont();
  if (!font) {
    return {
      markup: `<text x="${x}" y="${y}" font-family="Georgia, serif" font-style="italic" font-weight="600" font-size="${fontSize}" fill="${fill}" text-anchor="${anchor}">${escapeXml(text)}</text>`,
      width: text.length * fontSize * 0.5,
    };
  }
  const width = font.getAdvanceWidth(text, fontSize);
  const originX = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const glyphPath = font.getPath(text, originX, y, fontSize);
  return { markup: `<path d="${glyphPath.toPathData(2)}" fill="${fill}"/>`, width };
}
