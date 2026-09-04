// Feet+inches formatting/parsing. Construction and interior design
// measurements are conventionally written as feet-inches (4'-6"), not
// decimal feet (4.5) — this is the single boundary where that conversion
// happens. Internally, every calculation in the app (room dimensions,
// fixture positions/sizes, sqft, prompts sent to the image model) still
// works entirely in decimal feet, since that's simpler arithmetic; this
// module only formats it for display and parses it back from user input.

// Rounds to the nearest whole inch — sub-inch precision isn't meaningful
// for furniture/fixture placement, and would make the display noisy.
export function formatFeetInches(totalFeet: number): string {
  if (!Number.isFinite(totalFeet)) return "";
  const totalInches = Math.round(Math.max(0, totalFeet) * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return inches === 0 ? `${feet}'` : `${feet}'${inches}"`;
}

// Accepts: 4'6", 4' 6", 4'-6", 4ft 6in, 54" (inches only), 4.5 (decimal
// feet), 4 (whole feet). Returns null if it can't parse at all — callers
// should fall back to the last known-good value rather than silently
// zeroing a room out.
export function parseFeetInches(input: string): number | null {
  const s = input.trim();
  if (!s) return null;

  const inchesOnly = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in)$/i);
  if (inchesOnly) return Number(inchesOnly[1]) / 12;

  const feetInches = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)\s*[-\s]*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/i);
  if (feetInches) {
    const feet = Number(feetInches[1]);
    const inches = feetInches[2] ? Number(feetInches[2]) : 0;
    return feet + inches / 12;
  }

  const decimal = Number(s);
  if (Number.isFinite(decimal)) return decimal;

  return null;
}
