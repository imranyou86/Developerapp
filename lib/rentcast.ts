// Server-only. Thin wrapper around the RentCast API (https://www.rentcast.io)
// — never import this from a Client Component. RENTCAST_API_KEY is read here
// only; the browser never sees it.
//
// Written from RentCast's documented API shape. If a field or endpoint has
// drifted, calls throw with the raw response body attached so the mismatch
// is visible immediately instead of failing silently — see rentcastFetch.

const BASE_URL = "https://api.rentcast.io/v1";

function getApiKey(): string {
  if (!process.env.RENTCAST_API_KEY) {
    throw new Error("RENTCAST_API_KEY is not configured on the server.");
  }
  return process.env.RENTCAST_API_KEY;
}

async function rentcastFetch<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    headers: { "X-Api-Key": getApiKey(), Accept: "application/json" },
  });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`RentCast API error (${res.status}) at ${path}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`RentCast API returned a non-JSON response at ${path}: ${text.slice(0, 200)}`);
  }
}

export interface RentcastListing {
  id: string;
  formattedAddress: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  price?: number;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  status?: string;
  listedDate?: string;
  daysOnMarket?: number;
  propertyType?: string;
  latitude?: number;
  longitude?: number;
}

export async function searchListingsByZip(zipCode: string, limit = 20): Promise<RentcastListing[]> {
  const data = await rentcastFetch<RentcastListing[]>("/listings/sale", {
    zipCode,
    status: "Active",
    limit,
  });
  return Array.isArray(data) ? data : [];
}

export interface RentcastComparable {
  formattedAddress?: string;
  price?: number;
  listedDate?: string;
  removedDate?: string;
  squareFootage?: number;
  distance?: number;
  correlation?: number;
}

export interface RentcastValueEstimate {
  price: number | null;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  comparables: RentcastComparable[];
}

export async function getValueEstimate(address: string): Promise<RentcastValueEstimate> {
  const data = await rentcastFetch<{
    price?: number;
    priceRangeLow?: number;
    priceRangeHigh?: number;
    comparables?: RentcastComparable[];
  }>("/avm/value", { address });

  return {
    price: data.price ?? null,
    priceRangeLow: data.priceRangeLow ?? null,
    priceRangeHigh: data.priceRangeHigh ?? null,
    comparables: Array.isArray(data.comparables) ? data.comparables : [],
  };
}
