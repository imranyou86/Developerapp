// Fixed category list for the "Create a Warranty Request" form
// (app/projects/[id]/warranty-request/create-warranty-request-form.tsx) —
// a plain grouping label, not a diagnosis. Fixed rather than free text for
// the same reason lib/bankCategories.ts's list is fixed: it keeps the
// Contractor/Developer/PM triage queue organized by trade instead of
// fragmenting into near-duplicate free-text labels ("Roof leak" vs "roof
// leaking" vs "Leak in roof"). No DB check constraint backs this (same as
// bank_transactions.category) — it's a plain nullable text column, kept in
// sync with this list by convention only.
export const WARRANTY_REQUEST_CATEGORIES = [
  "Electrical",
  "Plumbing",
  "Roof / Leaks",
  "HVAC",
  "Structural",
  "Appliances",
  "Flooring",
  "Windows & Doors",
  "Exterior / Siding",
  "Other",
] as const;
