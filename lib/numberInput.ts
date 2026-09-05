// Several numeric fields keep their typed text as a plain string (so an
// empty field can mean "no value" rather than 0, and so a user can type
// "12." mid-decimal without it being coerced away). When one of those
// fields already displays "0" (a real saved value, or after clearing to
// empty and having that coerced back to "0" on save) and the user starts
// typing without first clearing it, the raw keystroke produces "0" + digit
// — e.g. "05" — and since nothing here re-parses that back to a canonical
// number, it stuck around indefinitely instead of just being a one-frame
// glitch. Run every keystroke through this to drop that redundant leading
// zero, while leaving a deliberate one before a decimal point ("0.5") alone.
export function stripLeadingZero(raw: string): string {
  return raw.replace(/^0+(?=\d)/, "");
}
