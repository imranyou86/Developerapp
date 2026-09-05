// Ambient types for parse-address (no official types ship for it) live in
// types/parse-address.d.ts.
import { parseLocation } from "parse-address";

// LADBS's Property Activity Report search has separate "House Number" and
// "Street Name" fields (with its own separate street-type field), so a
// single "copy the whole address" button isn't usable there. A hand-rolled
// comma-split regex broke on addresses typed without commas ("123 Main St
// Los Angeles CA 90012") by leaking the city into the "street" half.
// parse-address is a small, well-tested US address parser (a JS port of
// the long-standing Perl Geo::StreetAddress::US module) that handles both
// comma and no-comma forms, directional prefixes, and USPS street-type
// suffixes properly, so the returned `street` is already just the bare
// name ("Main", not "Main St" or "Main St, Los Angeles").
export function splitAddress(address: string): { number: string; street: string } {
  const parsed = parseLocation(address);
  return { number: parsed?.number ?? "", street: parsed?.street ?? "" };
}
