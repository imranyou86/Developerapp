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

