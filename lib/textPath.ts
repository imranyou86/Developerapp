import { parse as parseFont, type Font, type PathCommand } from "opentype.js";
import { caveatBold, playfairDisplayBold, arimoBold } from "@/lib/fonts/embedded";

// Every piece of text in the generated mood board collage (lib/moodBoard.ts)
// is rendered this way — as actual glyph OUTLINES, not an SVG <text>
// element with a font-family — because a real deployment of this app was
// found to have NO usable fonts available to its sharp/librsvg SVG
// rasterizer at all: even a plain `<text font-family="sans-serif">`
// rendered as empty tofu boxes. This sandbox's own dev container has
// DejaVu/Liberation/Inter etc. installed system-wide, which is exactly why
// that failure mode was missed in earlier local smoke tests — it only
// shows up where there's no font fallback to quietly catch the miss.
//
// Converting every string to glyph outlines (via opentype.js) sidesteps the
// deployment's font situation entirely: an SVG <path> is just vector
// geometry by the time it reaches the rasterizer, nothing to look up.
// There is deliberately no plain-<text> fallback path anymore — that was
// tried first and is exactly what produced the tofu boxes in production.
//
// The font bytes themselves come from lib/fonts/embedded.ts (base64
// constants), not a separate .ttf read off disk at runtime — an earlier
// version of this file did read the .ttf files directly via
// fs.readFileSync(path.join(process.cwd(), "lib", "fonts", ...)), with
// next.config.js's outputFileTracingIncludes explicitly listing
// lib/fonts/**/* to make sure the binary files survived deployment. That
// still weren't making it into the actual running deployment (confirmed:
// the glyph-outline text rendered as blank/invisible, meaning loadFont()
// was silently failing and returning null) — something about this
// deployment's own build/bundle step wasn't carrying loose binary assets
// through, whatever next's own tracing said should happen. Embedding the
// bytes as a plain string constant sidesteps that whole class of bundling
// problem: a JS/TS string is something every bundler already handles
// correctly by construction.
//
// Fonts (all SIL Open Font License — the original .ttf files and each
// font's *-OFL.txt stay in lib/fonts/ for reference/licensing, just no
// longer read at runtime):
//   - Caveat Bold      — "script": handwritten accents (a subtitle, the
//                        materials-arrow label, swatch card text)
//   - Playfair Display Bold — "serif": the bold headline (room name)
//   - Arimo Bold       — "sans": small/functional text (kicker, tags).
//     (Inter — this app's own UI font — was tried first and rejected: its
//     GSUB table hits an opentype.js shaping code path ("substFormat: 2
//     ... not yet supported") that throws outright, confirmed directly
//     against the bundled Inter-Bold.ttf before switching to Arimo.)
//
// Imported as NAMED exports (`import { parse, type Font } from
// "opentype.js"`), not `import opentype from "opentype.js"` — confirmed,
// from an actual production stack trace, that the default-import form
// compiles (via Next's production bundler) to a call shaped like
// `Q.default.parse(...)`, expecting a `.default` property that this CJS
// package's module.exports doesn't actually have, so it was `undefined`
// at runtime and every call threw "Cannot read properties of undefined
// (reading 'parse')" — silently caught by the try/catch below, which is
// what made every piece of text disappear despite the embedded font data
// itself loading correctly (right base64 length, decoded fine). This
// local sandbox's own tests never caught it because they ran the .ts
// files directly through plain Node (or ts-node-style stripping), never
// through Next's actual webpack production bundle — the one place this
// particular interop bug could show up. Named imports map directly to
// properties read off the module object, without that extra `.default`
// indirection, so they don't have this failure mode.

export type FontKey = "script" | "serif" | "sans";

const FONT_DATA: Record<FontKey, string> = {
  script: caveatBold,
  serif: playfairDisplayBold,
  sans: arimoBold,
};

const cache = new Map<FontKey, Font | null>();

// Logged once per font per cold start, deliberately not gated behind a
// debug flag — this is the one place a production failure here has
// otherwise been silent (text just doesn't appear, nothing throws up to
// the caller), and that silence is exactly what made the earlier rounds
// of this bug hard to pin down from outside the deployment.
function loadFont(key: FontKey): Font | null {
  if (cache.has(key)) return cache.get(key) ?? null;
  const base64 = FONT_DATA[key];
  try {
    const buf = Buffer.from(base64, "base64");
    console.log(
      `textPath: loading "${key}" — base64 string length ${base64.length}, decoded buffer ${buf.length} bytes`
    );
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const font = parseFont(arrayBuffer);
    console.log(`textPath: "${key}" parsed ok — ${font.glyphs.length} glyphs, unitsPerEm ${font.unitsPerEm}`);
    cache.set(key, font);
    return font;
  } catch (err) {
    console.error(
      `textPath: COULD NOT decode/parse the embedded "${key}" font (base64 string length ${base64.length}):`,
      err
    );
    cache.set(key, null);
    return null;
  }
}

export interface TextPathResult {
  markup: string;
  width: number;
}

// Round to 2 decimal places, but never let a value that rounds to "-0"
// render as a bare "-0"/"0" — formats every number as its own token with
// an explicit leading space, never relying on a minus sign to double as
// the separator between numbers the way `path.toPathData()` does.
function formatNum(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded === 0 ? "0" : String(rounded);
}

// Serializes a glyph path ourselves instead of calling opentype.js's own
// `toPathData()` — confirmed directly (against the bundled Arimo-Bold.ttf,
// rendering "Travertine floor tile") that it has a real bug: when a
// coordinate rounds to exactly "-0" at the requested precision, the minus
// sign disappears, and since toPathData() omits the space before a
// negative number (using the "-" itself as an implicit separator between
// numbers), losing that sign also silently drops the separator — two
// numbers run together into one malformed token, the argument count for
// that command (and everything after it in the path) desyncs, and the
// rest of the string renders as corrupted/missing glyphs. Always including
// an explicit space between every number, as below, sidesteps the whole
// bug class rather than working around this one instance of it.
function commandsToPathData(commands: PathCommand[]): string {
  const parts: string[] = [];
  for (const c of commands) {
    switch (c.type) {
      case "M":
        parts.push(`M ${formatNum(c.x)} ${formatNum(c.y)}`);
        break;
      case "L":
        parts.push(`L ${formatNum(c.x)} ${formatNum(c.y)}`);
        break;
      case "Q":
        parts.push(`Q ${formatNum(c.x1)} ${formatNum(c.y1)} ${formatNum(c.x)} ${formatNum(c.y)}`);
        break;
      case "C":
        parts.push(`C ${formatNum(c.x1)} ${formatNum(c.y1)} ${formatNum(c.x2)} ${formatNum(c.y2)} ${formatNum(c.x)} ${formatNum(c.y)}`);
        break;
      case "Z":
        parts.push("Z");
        break;
    }
  }
  return parts.join(" ");
}

// `x` is always the LEFT edge regardless of anchor — for "middle"/"end"
// the caller gets the actual rendered width back to do their own layout
// math (centering, arrow start points) rather than this function guessing
// what they need. `tracking` adds fixed extra space (px, at this
// `fontSize`) between every character — opentype.js's getPath has no
// built-in letter-spacing, so wide-tracked text (the "MOOD BOARD" kicker)
// is laid out one glyph at a time.
export function textPath(
  key: FontKey,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fill: string,
  anchor: "start" | "middle" | "end" = "start",
  tracking = 0
): TextPathResult {
  const font = loadFont(key);
  if (!font) {
    // No usable fallback font exists in the environment that made this
    // function necessary in the first place — an empty result (nothing
    // drawn) is the honest outcome here, not a <text> element that would
    // just reproduce the original tofu-box bug.
    console.error(`textPath: "${key}" font unavailable (failed to load) — rendering "${text}" as nothing.`);
    return { markup: "", width: 0 };
  }

  try {
    if (tracking === 0) {
      const width = font.getAdvanceWidth(text, fontSize);
      const originX = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
      const glyphPath = font.getPath(text, originX, y, fontSize);
      const d = commandsToPathData(glyphPath.commands);
      if (!d) console.error(`textPath: "${key}" produced an empty path for "${text}" (${glyphPath.commands.length} commands).`);
      return { markup: `<path d="${d}" fill="${fill}"/>`, width };
    }

    const chars = Array.from(text);
    let width = 0;
    for (const ch of chars) {
      width += font.getAdvanceWidth(ch, fontSize) + tracking;
    }
    width -= tracking; // no trailing tracking after the last character

    let cursor = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    let markup = "";
    for (const ch of chars) {
      const glyphPath = font.getPath(ch, cursor, y, fontSize);
      markup += `<path d="${commandsToPathData(glyphPath.commands)}" fill="${fill}"/>`;
      cursor += font.getAdvanceWidth(ch, fontSize) + tracking;
    }
    return { markup, width };
  } catch (err) {
    // Render nothing for just this one string rather than letting an
    // exception here fail the entire collage — but log loudly, since a
    // silent catch here is exactly the kind of thing that made the last
    // two rounds of this bug invisible from outside the deployment.
    console.error(`textPath: threw while rendering "${text}" with "${key}":`, err);
    return { markup: "", width: 0 };
  }
}
