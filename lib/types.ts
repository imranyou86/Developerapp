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

export type StyleName =
  | "Warm Modern Minimalist"
  | "Modern Farmhouse"
  | "Scandinavian"
  | "Industrial Loft"
  | "Transitional Classic";

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

export interface CostBreakdownLine {
  category: string;
  pct: number;
  cost: number;
  description: string;
}

export interface CostEstimate {
  id: string;
  project_id: string;
  total_sqft: number | null;
  stories: number | null;
  quality_tier: QualityTier | null;
  cost_per_sqft_low: number | null;
  cost_per_sqft_mid: number | null;
  cost_per_sqft_high: number | null;
  total_cost_low: number | null;
  total_cost_mid: number | null;
  total_cost_high: number | null;
  complexity_factors: string[];
  breakdown: CostBreakdownLine[];
  reasoning: string | null;
  created_at: string;
}

