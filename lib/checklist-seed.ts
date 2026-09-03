import type { ChecklistPhase } from "@/lib/types";

export interface ChecklistSeedItem {
  phase: ChecklistPhase;
  title: string;
}

// Standard ~34-item construction QA checklist, seeded once per project on
// first visit to the Checklist tab.
export const CHECKLIST_SEED: ChecklistSeedItem[] = [
  // Rough-in
  { phase: "rough", title: "Site protection & erosion control in place" },
  { phase: "rough", title: "Demolition complete & debris cleared" },
  { phase: "rough", title: "Footings excavated & formed" },
  { phase: "rough", title: "Foundation poured & cured" },
  { phase: "rough", title: "Foundation inspection passed" },
  { phase: "rough", title: "Framing — walls, floors & roof structure complete" },
  { phase: "rough", title: "Framing inspection passed" },
  { phase: "rough", title: "Rough plumbing installed (supply, waste, vent)" },
  { phase: "rough", title: "Rough plumbing inspection passed" },
  { phase: "rough", title: "Rough electrical installed (wiring, panels, boxes)" },
  { phase: "rough", title: "Rough electrical inspection passed" },
  { phase: "rough", title: "Rough mechanical / HVAC installed (ducts, lines)" },
  { phase: "rough", title: "Rough mechanical inspection passed" },
  { phase: "rough", title: "Windows & exterior doors installed" },
  { phase: "rough", title: "Roofing installed" },
  { phase: "rough", title: "Weatherproofing / house wrap complete" },
  { phase: "rough", title: "Insulation installed (walls, attic, floors)" },
  { phase: "rough", title: "Insulation inspection passed" },

  // Finish
  { phase: "finish", title: "Drywall hung, taped & finished" },
  { phase: "finish", title: "Interior doors & trim installed" },
  { phase: "finish", title: "Cabinetry installed" },
  { phase: "finish", title: "Countertops installed" },
  { phase: "finish", title: "Tile work complete" },
  { phase: "finish", title: "Flooring installed" },
  { phase: "finish", title: "Paint — interior & exterior complete" },
  { phase: "finish", title: "Plumbing fixtures installed" },
  { phase: "finish", title: "Appliances installed" },
  { phase: "finish", title: "Hardware installed (door, cabinet, bath)" },
  { phase: "finish", title: "Final HVAC startup & balancing" },
  { phase: "finish", title: "Exterior finishes complete (siding, trim, paint)" },
  { phase: "finish", title: "Landscaping & grading complete" },
  { phase: "finish", title: "Punch list walkthrough complete" },
  { phase: "finish", title: "Final inspection passed" },
  { phase: "finish", title: "Certificate of occupancy issued" },
];
