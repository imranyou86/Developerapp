export type FinishCategory =
  | "Tile"
  | "Fixture"
  | "Flooring"
  | "Countertop"
  | "Cabinetry"
  | "Hardware"
  | "Lighting"
  | "Paint/Finish"
  | "Appliance"
  | "Other";

export type ChecklistPhase = "rough" | "finish";

// Used to be a fixed 5-value union (one fixed preset design style) — the
// Rooms tab now lets someone type/search any style name and pick their own
// colors instead of choosing from a locked list, so this is just a plain
// string. Kept as a named alias rather than inlining `string` everywhere
// that used to import it, purely so those call sites stay self-documenting.
export type StyleName = string;

export interface Project {
  id: string;
  user_id: string;
  name: string;
  address: string | null;
  created_at: string;
}

export interface PlanPage {
  id: string;
  project_id: string;
  storage_url: string;
  label: string;
  sort_order: number;
  is_layout: boolean;
  created_at: string;
}

export interface Room {
  id: string;
  project_id: string;
  name: string;
  type: string | null;
  width: number | null;
  depth: number | null;
  floor: number | null;
  estimated: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  room_id: string;
  title: string;
  due_date: string | null;
  done: boolean;
  created_at: string;
}

export interface BudgetItem {
  id: string;
  room_id: string;
  item: string;
  budgeted: number;
  actual: number;
  finish_id: string | null;
  created_at: string;
}

export interface Finish {
  id: string;
  room_id: string;
  name: string;
  category: FinishCategory;
  brand: string | null;
  price: number | null;
  created_at: string;
}

export interface IdentifiedFinish {
  name: string;
  category: FinishCategory;
  description: string;
  color: string | null;
  confidence: "high" | "medium" | "low";
}

export interface FinishScan {
  id: string;
  project_id: string;
  storage_url: string;
  label: string | null;
  results: IdentifiedFinish[];
  created_at: string;
}

export interface Rendering {
  id: string;
  room_id: string;
  style: StyleName;
  label: string | null;
  colors: string[];
  description: string | null;
  image_prompt: string | null;
  illustration_svg: string | null;
  uploaded_photo_url: string | null;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  project_id: string;
  phase: ChecklistPhase;
  title: string;
  done: boolean;
  comment: string | null;
  created_at: string;
}

export interface ChecklistPhoto {
  id: string;
  checklist_item_id: string;
  storage_url: string;
  created_at: string;
}

export interface Bid {
  id: string;
  project_id: string;
  contractor: string;
  total_amount: number;
  file_name: string | null;
  file_url: string | null;
  uploaded_at: string;
}

export interface PaymentScheduleItem {
  id: string;
  bid_id: string;
  label: string;
  amount: number;
  paid: boolean;
}

export interface ProjectShare {
  id: string;
  project_id: string;
  token: string;
  created_at: string;
  revoked_at: string | null;
}

export type FileCategory =
  | "plan"
  | "bid"
  | "checklist_photo"
  | "rendering"
  | "finish_scan"
  | "document"
  | "photo"
  | "interior_design"
  | "landscape_design";

export interface ProjectFile {
  id: string;
  project_id: string;
  storage_url: string;
  file_name: string;
  category: FileCategory;
  source_table: string | null;
  source_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface PlacedFixture {
  id: string;
  typeId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotated: boolean;
  /** Optional freeform note, e.g. "stainless steel, French door" — folded into the generated image prompt. */
  detail?: string;
}

export interface InteriorDesign {
  id: string;
  project_id: string;
  room_id: string | null;
  room_type: string;
  style: string;
  width: number | null;
  depth: number | null;
  sqft: number | null;
  layout: PlacedFixture[];
  original_photo_url: string | null;
  generated_image_url: string;
  prompt: string;
  created_at: string;
}

export interface LandscapeComponentSelection {
  id: string;
  label: string;
  detail: string;
}

export interface LandscapeDesign {
  id: string;
  project_id: string | null;
  style: string;
  components: LandscapeComponentSelection[];
  notes: string | null;
  original_photo_url: string;
  generated_image_url: string;
  prompt: string;
  created_at: string;
}

export interface ProjectMessage {
  id: string;
  project_id: string;
  user_id: string;
  sender_email: string;
  body: string;
  created_at: string;
}

export type DealStatus = "researching" | "pursuing" | "passed" | "converted";

export interface Deal {
  id: string;
  user_id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string;
  list_price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lot_size: number | null;
  year_built: number | null;
  listing_url: string | null;
  photo_url: string | null;
  zone: string | null;
  lot_coverage_pct: number | null;
  status: DealStatus;
  project_id: string | null;
  created_at: string;
}

export type DealVerdict = "good_deal" | "marginal" | "pass";
export type DealScope = "remodel" | "ground_up";

export interface DealComp {
  address: string;
  sold_price: number | null;
  sold_date: string | null;
  sqft: number | null;
  distance_miles: number | null;
  source: string;
  url: string | null;
}

export interface DealAnalysis {
  id: string;
  deal_id: string;
  scope: DealScope;
  scope_description: string | null;
  target_sqft: number | null;
  cost_per_sqft: number;
  construction_budget: number;
  current_value_estimate: number | null;
  arv_estimate: number | null;
  arv_low: number | null;
  arv_high: number | null;
  total_cost: number;
  estimated_profit: number | null;
  profit_margin_pct: number | null;
  verdict: DealVerdict;
  reasoning: string | null;
  comps: DealComp[];
  created_at: string;
}

export type QualityTier = "economy" | "standard" | "premium" | "luxury";
export type CostTier = "low" | "mid" | "high";
export type PredictionConfidence = "high" | "medium" | "low";

export interface CostBreakdownLine {
  category: string;
  pct: number;
  cost: number;
  description: string;
}

export type UserRole = "owner" | "pm" | "contractor" | "developer";

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface TabPermission {
  role: UserRole;
  tab: string;
  allowed: boolean;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: UserRole;
  invited_by: string | null;
  created_at: string;
}

export type InviteStatus = "pending" | "accepted" | "revoked";

export interface ProjectInvite {
  id: string;
  project_id: string;
  email: string;
  role: UserRole;
  invited_by: string;
  token: string;
  status: InviteStatus;
  created_at: string;
  accepted_at: string | null;
}

export interface CostEstimate {
  id: string;
  project_id: string;
  total_sqft: number | null;
  stories: number | null;
  quality_tier: QualityTier | null;
  cost_tier: CostTier | null;
  cost_per_sqft_low: number | null;
  cost_per_sqft_mid: number | null;
  cost_per_sqft_high: number | null;
  total_cost_low: number | null;
  total_cost_mid: number | null;
  total_cost_high: number | null;
  predicted_cost_per_sqft: number | null;
  contingency_pct: number | null;
  predicted_total_cost: number | null;
  prediction_confidence: PredictionConfidence | null;
  prediction_notes: string | null;
  complexity_factors: string[];
  breakdown: CostBreakdownLine[];
  reasoning: string | null;
  created_at: string;
}

// Shared subcontractor directory (app/subcontractors/) — not scoped to a
// project. `reliability` is a 1-5 star rating, `cost_tier` a 1-4 "$" tier
// (like a Yelp price rating); both null until someone's actually rated the
// sub. `created_by` gates who can edit/delete a row (see the RLS policies
// in supabase/schema.sql) — anyone signed in can read the whole directory.
export interface Subcontractor {
  id: string;
  created_by: string;
  company_name: string;
  contact_name: string | null;
  trade: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  license_number: string | null;
  license_state: string | null;
  license_status: string | null;
  license_checked_at: string | null;
  reliability: number | null;
  cost_tier: number | null;
  notes: string | null;
  created_at: string;
}

export interface COClearance {
  code: string | null;
  description: string;
}

export interface COPermit {
  permit_number: string | null;
  type: string | null;
  status: string | null;
  issued_date: string | null;
  description: string | null;
}

export interface COInspector {
  name: string | null;
  phone: string | null;
  email: string | null;
  department: string | null;
}

// One row per project (app/projects/[id]/certificate-of-occupancy/), kept
// current rather than kept as history — "Update information" overwrites
// this row with a fresh lookup rather than accumulating past checks, since
// what matters here is the current status, not a timeline of past ones.
// Best-effort AI web search against public records (primarily LADBS), not
// a live query against the department's own database — see `confidence`/
// `notes` for how much to trust a given result.
export interface CertificateOfOccupancy {
  id: string;
  project_id: string;
  status: string | null;
  co_number: string | null;
  issued_date: string | null;
  open_clearances: COClearance[];
  permits: COPermit[];
  inspector: COInspector | null;
  source_url: string | null;
  confidence: "high" | "medium" | "low" | null;
  notes: string | null;
  last_checked_at: string;
  created_at: string;
}

