// Shared category list for the Bank Transactions tab's Profit & Loss
// statement (app/projects/[id]/bank-transactions). This is a plain grouping
// label, not tax guidance — what's capitalized vs. deductible, and how a
// given cost should actually be treated, is a question for whoever prepares
// the return; this just keeps categorization consistent enough that the P&L
// groups sensibly instead of fragmenting into near-duplicate free-text labels.
//
// The first three are the categories actually used day to day (the
// property's purchase price, a single lump-sum construction cost, and
// property tax); Materials/Labor below them stay available for anyone who
// wants a more granular breakdown of the construction cost instead of one
// line — both are valid, pick whichever level of detail fits a given entry.
export const BANK_TXN_CATEGORIES = [
  "Property Value",
  "Construction Cost",
  "Property Tax",
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
