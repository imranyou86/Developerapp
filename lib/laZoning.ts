export interface LaZone {
  code: string;
  label: string;
}

// LAMC (Los Angeles Municipal Code) residential zones relevant to
// single-family and low-density construction — not every zone in the code
// (commercial/industrial/high-density multi-family are out of scope for
// this app's ground-up rebuild calculator). Ordered roughly lowest to
// highest density.
export const LA_ZONES: LaZone[] = [
  { code: "RA", label: "RA — Suburban" },
  { code: "RE40", label: "RE40 — Residential Estate (40,000 sqft min lot)" },
  { code: "RE20", label: "RE20 — Residential Estate (20,000 sqft min lot)" },
  { code: "RE15", label: "RE15 — Residential Estate (15,000 sqft min lot)" },
  { code: "RE11", label: "RE11 — Residential Estate (11,000 sqft min lot)" },
  { code: "RE9", label: "RE9 — Residential Estate (9,000 sqft min lot)" },
  { code: "RS", label: "RS — Suburban" },
  { code: "R1", label: "R1 — One-Family" },
  { code: "R1V1", label: "R1V1 — One-Family, Variation 1" },
  { code: "R1V2", label: "R1V2 — One-Family, Variation 2" },
  { code: "R1V3", label: "R1V3 — One-Family, Variation 3" },
  { code: "R1F", label: "R1F — One-Family, Small Lot" },
  { code: "R1R", label: "R1R — One-Family Hillside, Rural" },
  { code: "R1H", label: "R1H — One-Family Hillside" },
  { code: "RU", label: "RU — One-Family Restricted Density" },
  { code: "RZ2.5", label: "RZ2.5 — One-Family Zero Lot Line (2.5 units/lot)" },
  { code: "RZ3", label: "RZ3 — One-Family Zero Lot Line (3 units/lot)" },
  { code: "RZ4", label: "RZ4 — One-Family Zero Lot Line (4 units/lot)" },
  { code: "RW1", label: "RW1 — One-Family Small Lot Waiver" },
  { code: "R2", label: "R2 — Two-Family" },
  { code: "RD6", label: "RD6 — Restricted Density Multiple (6 units/lot)" },
  { code: "RD5", label: "RD5 — Restricted Density Multiple (5 units/lot)" },
  { code: "RD4", label: "RD4 — Restricted Density Multiple (4 units/lot)" },
  { code: "RD3", label: "RD3 — Restricted Density Multiple (3 units/lot)" },
  { code: "RD2", label: "RD2 — Restricted Density Multiple (2 units/lot)" },
  { code: "RD1.5", label: "RD1.5 — Restricted Density Multiple (1.5 units/lot)" },
  { code: "R3", label: "R3 — Multiple Dwelling" },
  { code: "RAS3", label: "RAS3 — Residential/Accessory Services (R3 density)" },
  { code: "R4", label: "R4 — Multiple Dwelling" },
  { code: "RAS4", label: "RAS4 — Residential/Accessory Services (R4 density)" },
  { code: "R5", label: "R5 — Multiple Dwelling, High Density" },
];
