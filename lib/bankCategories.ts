// Shared category list for the Bank Transactions tab's Profit & Loss
// statement (app/projects/[id]/bank-transactions). This is a plain grouping
// label, not tax guidance — what's capitalized vs. deductible, and how a
// given cost should actually be treated, is a question for whoever prepares
// the return; this just keeps categorization consistent enough that the P&L
// groups sensibly instead of fragmenting into near-duplicate free-text labels.
export const BANK_TXN_CATEGORIES = [
  "Land / Acquisition",
  "Materials",
  "Labor / Subcontractors",
  "Permits & Fees",
  "Insurance",
  "Financing / Interest",
  "Utilities",
  "Professional Fees",
  "Selling Costs",
  "Sale Proceeds / Revenue",
  "Loan Proceeds",
  "Other",
] as const;
