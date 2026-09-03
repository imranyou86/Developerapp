import type { FinishCategory } from "@/lib/types";

export interface FinishProduct {
  category: FinishCategory;
  brand: string;
  name: string;
  price: number;
}

// Browsable database of common brands/products per category, used to prefill
// finish entries quickly. Prices are rough retail estimates for planning.
export const FINISHES_DB: FinishProduct[] = [
  // Tile
  { category: "Tile", brand: "Daltile", name: "Marazzi Montagna Wood-Look Porcelain", price: 3.49 },
  { category: "Tile", brand: "Daltile", name: "Rittenhouse Square Ceramic Subway", price: 2.29 },
  { category: "Tile", brand: "Emser Tile", name: "Marble Carrara Polished 12x24", price: 8.99 },
  { category: "Tile", brand: "Fireclay Tile", name: "Handmade Ceramic Subway 3x6", price: 12.5 },

  // Fixture
  { category: "Fixture", brand: "Kohler", name: "Purist Widespread Bath Faucet", price: 429 },
  { category: "Fixture", brand: "Kohler", name: "Cimarron Comfort Height Toilet", price: 349 },
  { category: "Fixture", brand: "Delta", name: "Trinsic Single-Handle Shower Trim", price: 259 },
  { category: "Fixture", brand: "Moen", name: "Align Pull-Down Kitchen Faucet", price: 349 },

  // Flooring
  { category: "Flooring", brand: "Shaw", name: "Floorte Pro Waterproof LVP", price: 4.29 },
  { category: "Flooring", brand: "Shaw", name: "Reflections Engineered White Oak", price: 6.99 },
  { category: "Flooring", brand: "Mohawk", name: "RevWood Select Laminate", price: 3.79 },
  { category: "Flooring", brand: "Bruce", name: "Natural Choice Solid Hardwood", price: 5.49 },

  // Countertop
  { category: "Countertop", brand: "Caesarstone", name: "Pure White Quartz Slab", price: 65 },
  { category: "Countertop", brand: "Caesarstone", name: "Calacatta Nuvo Quartz Slab", price: 85 },
  { category: "Countertop", brand: "Cambria", name: "Brittanicca Quartz Slab", price: 90 },
  { category: "Countertop", brand: "MSI", name: "Calacatta Miraggio Porcelain Slab", price: 55 },

  // Cabinetry
  { category: "Cabinetry", brand: "KraftMaid", name: "Shaker Maple Full-Overlay", price: 320 },
  { category: "Cabinetry", brand: "Kraftmaid", name: "Painted Recessed-Panel Cabinets", price: 350 },
  { category: "Cabinetry", brand: "IKEA", name: "SEKTION Shaker Cabinet System", price: 180 },
  { category: "Cabinetry", brand: "Wellborn Cabinet", name: "Frameless Slab Door Line", price: 300 },

  // Hardware
  { category: "Hardware", brand: "Emtek", name: "Sandcast Bronze Cabinet Pull", price: 22 },
  { category: "Hardware", brand: "Schlage", name: "Century Lever Interior Door Set", price: 65 },
  { category: "Hardware", brand: "Top Knobs", name: "Aspen II Knob, Oil-Rubbed Bronze", price: 8 },
  { category: "Hardware", brand: "Baldwin", name: "Reserve Contemporary Deadbolt", price: 149 },

  // Lighting
  { category: "Lighting", brand: "Visual Comfort", name: "Ellery Pendant, Aged Brass", price: 495 },
  { category: "Lighting", brand: "Progress Lighting", name: "Alpha LED Recessed Downlight", price: 45 },
  { category: "Lighting", brand: "Hinkley", name: "Sussex Outdoor Wall Sconce", price: 219 },
  { category: "Lighting", brand: "Kichler", name: "Barrington Linear Chandelier", price: 389 },

  // Paint/Finish
  { category: "Paint/Finish", brand: "Behr", name: "Marquee Interior Eggshell", price: 54 },
  { category: "Paint/Finish", brand: "Behr", name: "Premium Plus Exterior Satin", price: 42 },
  { category: "Paint/Finish", brand: "Sherwin-Williams", name: "Emerald Interior Acrylic", price: 79 },
  { category: "Paint/Finish", brand: "Benjamin Moore", name: "Regal Select Matte", price: 68 },

  // Appliance
  { category: "Appliance", brand: "GE Profile", name: "36in French-Door Refrigerator", price: 2799 },
  { category: "Appliance", brand: "Bosch", name: "800 Series Dishwasher", price: 1099 },
  { category: "Appliance", brand: "KitchenAid", name: "30in 5-Burner Gas Range", price: 2199 },
  { category: "Appliance", brand: "Wolf", name: "36in Dual-Fuel Range", price: 8999 },

  // Other
  { category: "Other", brand: "Rejuvenation", name: "House Numbers, Solid Brass", price: 45 },
  { category: "Other", brand: "Andersen", name: "400 Series Casement Window", price: 899 },
  { category: "Other", brand: "Therma-Tru", name: "Fiberglass Entry Door System", price: 1299 },
];

export const FINISH_CATEGORIES: FinishCategory[] = [
  "Tile",
  "Fixture",
  "Flooring",
  "Countertop",
  "Cabinetry",
  "Hardware",
  "Lighting",
  "Paint/Finish",
  "Appliance",
  "Other",
];

export function productsByCategory(category: FinishCategory): FinishProduct[] {
  return FINISHES_DB.filter((p) => p.category === category);
}
