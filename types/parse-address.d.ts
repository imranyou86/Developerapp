// No official types ship for parse-address. Global ambient declaration
// (not a module augmentation, since parse-address itself has no types to
// augment) for just the one function lib/address.ts calls.
declare module "parse-address" {
  export interface ParsedAddress {
    number?: string;
    prefix?: string;
    street?: string;
    type?: string;
    city?: string;
    state?: string;
    zip?: string;
  }
  export function parseLocation(input: string): ParsedAddress | null;
}
