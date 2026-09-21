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

// "warranty" items live in the same checklist_items/checklist_photos tables
// as the rough-in/finish QA checklist (same shape: title/done/comment/
// photos), but render on their own tab (app/projects/[id]/warranty-request/)
// rather than in the Checklist tab's rough/finish columns — see
// ChecklistClient's phase filter, which simply never matches "warranty".
export type ChecklistPhase = "rough" | "finish" | "warranty";

// Warranty-only review status on a checklist_items row, independent of
// "done" — an item can be validated but not yet fixed, or invalidated and
// never fixed at all. Rough/finish items never touch this.
export type WarrantyItemStatus = "pending" | "validated" | "invalidated";

// Used to be a fixed 5-value union (one fixed preset design style) — the
// Rooms tab now lets someone type/search any style name and pick their own
// colors instead of choosing from a locked list, so this is just a plain
// string. Kept as a named alias rather than inlining `string` everywhere
// that used to import it, purely so those call sites stay self-documenting.
export type StyleName = string;

export type ProjectKind = "construction" | "warranty_tracker";

export interface Project {
  id: string;
  user_id: string;
  name: string;
  address: string | null;
  kind: ProjectKind;
  created_at: string;
}

export interface PlanPage {
  id: string;
  project_id: string | null;
  created_by: string;
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

export type TradeBidVerdict = "good_price" | "fair_price" | "high_price";
export type TradeBidConfidence = "high" | "medium" | "low";

// Construction Cost's "Trade Bid Review" section — see supabase/migrations/059.
export interface TradeBidReview {
  id: string;
  project_id: string;
  trade: string;
  subcontractor_name: string;
  subcontractor_id: string | null;
  bid_amount: number;
  scope_notes: string | null;
  file_name: string | null;
  file_url: string | null;
  evaluation_verdict: TradeBidVerdict | null;
  evaluation_confidence: TradeBidConfidence | null;
  evaluation_market_low: number | null;
  evaluation_market_high: number | null;
  evaluation_analysis: string | null;
  evaluation_questions: string[];
  evaluation_scope_complete: boolean | null;
  evaluation_missing_items: string[];
  evaluation_completeness_note: string | null;
  evaluated_at: string | null;
  created_at: string;
}

export interface BankTransaction {
  id: string;
  project_id: string;
  bid_id: string | null;
  txn_date: string;
  description: string;
  amount: number;
  type: "debit" | "credit";
  category: string | null;
  include_in_pl: boolean;
  source_file_name: string | null;
  created_at: string;
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
  | "trade_bid"
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
  layout: PlacedFixture[];
  yard_width: number | null;
  yard_depth: number | null;
  created_at: string;
}

// Warranty Request tab uploads (app/projects/[id]/warranty-request/) — any
// file type, stored in the 'project-files' bucket. checklist_item_id is
// null until attached to a specific warranty item; warranty_item_request_id
// is the other, independent attachment point — set when the person who
// filed the request (or a manager) attaches evidence directly to the
// request itself, before it's ever been approved into a checklist item.
export interface InspectionReport {
  id: string;
  project_id: string;
  checklist_item_id: string | null;
  warranty_item_request_id: string | null;
  file_name: string;
  storage_url: string;
  created_at: string;
}

export interface ProjectMessage {
  id: string;
  project_id: string;
  user_id: string;
  sender_email: string;
  // Denormalized display name at write time — null falls back to
  // sender_email wherever this is rendered.
  sender_name: string | null;
  body: string;
  created_at: string;
  // Null = the project-wide General chat; set = a scoped chat_threads row
  // (see ChatThread below) — only that thread's participants can see it.
  thread_id: string | null;
}

// A named, scoped chat thread within a construction's Chat tab — created
// by a Developer/Contractor/PM to talk with just a subset of the team
// (e.g. one subcontractor account + the owner) instead of the whole
// project. See migration 060.
export interface ChatThread {
  id: string;
  project_id: string;
  created_by: string;
  title: string;
  created_at: string;
}

export interface ChatThreadParticipant {
  thread_id: string;
  user_id: string;
}

export interface ActivityLogEntry {
  id: string;
  project_id: string;
  user_id: string | null;
  // Denormalized display name (or email) at write time, same reasoning as
  // ProjectMessage.sender_name — profiles_select only lets a user read
  // their own row, so a live join to resolve another member's name
  // wouldn't work here. Null on a row logged before this column existed.
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail: string | null;
  created_at: string;
}

export interface ProjectAlertSubscription {
  id: string;
  project_id: string;
  user_id: string;
  email: string;
  created_at: string;
}

export type WarrantyItemRequestStatus = "pending" | "approved" | "rejected";

// Independent of WarrantyItemRequestStatus above: `status` is the triage
// decision (does this become a real checklist item at all); `progress` is
// Contractor/Developer/PM tracking the actual work on it through to done,
// and moves separately from (and usually after) that decision.
export type WarrantyRequestProgress = "open" | "in_progress" | "complete";

export interface WarrantyItemRequest {
  id: string;
  project_id: string;
  title: string;
  comment: string | null;
  // Fixed option list — see lib/warrantyRequestCategories.ts.
  category: string | null;
  requested_by: string;
  status: WarrantyItemRequestStatus;
  progress: WarrantyRequestProgress;
  subcontractor_id: string | null;
  checklist_item_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  // When the assigned subcontractor is expected to show up — set by
  // whoever manages the request (see setWarrantyRequestSchedule), shown to
  // the homeowner who filed it and surfaced on /calendar.
  scheduled_date: string | null;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  // Set when a Contractor/Developer/PM rejects the request — shown to the
  // homeowner who filed it.
  rejection_note: string | null;
  // Groups multiple tasks filed under one trade into a single ticket — see
  // requestWarrantyItems. true on the parent row (its own status/
  // checklist_item_id/rejection_note go unused); group_id on a task row
  // points back to its parent and is null for a standalone single request.
  is_group: boolean;
  group_id: string | null;
  created_at: string;
}

// A manually-added calendar item (meeting, site visit, anything that isn't
// a room task due date or a warranty visit) — see app/calendar/actions.ts.
export interface CalendarEvent {
  id: string;
  project_id: string;
  title: string;
  notes: string | null;
  event_date: string;
  time_start: string | null;
  time_end: string | null;
  created_by: string;
  created_at: string;
}

// A running comment/notes thread Contractor/Developer/PM keep on a
// warranty request — the 'warranty' role who filed it can watch this
// change but never post. sender_email is denormalized at write time, same
// reasoning as ProjectMessage.sender_email above.
export interface WarrantyItemRequestComment {
  id: string;
  request_id: string;
  user_id: string;
  sender_email: string;
  // Denormalized display name at write time — null falls back to
  // sender_email wherever this is rendered.
  sender_name: string | null;
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

// "warranty" is for a homeowner given access after their construction is
// complete — an account-level role like the others, so it's simplest for
// the (typically) single-project person it's meant for, even though it
// means it can't be scoped to just one of several projects the same
// account belongs to (see lib/permissions.ts's PROJECT_TABS comment).
export type UserRole = "owner" | "pm" | "contractor" | "developer" | "warranty";

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  is_test: boolean;
  display_name: string | null;
  created_at: string;
}

export interface TabPermission {
  role: UserRole;
  tab: string;
  allowed: boolean;
}

// A per-account exception on top of the role-wide TabPermission matrix —
// see user_tab_permissions in supabase/schema.sql.
export interface UserTabPermission {
  user_id: string;
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
  project_id: string | null;
  created_by: string;
  title: string | null;
  location: string | null;
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

