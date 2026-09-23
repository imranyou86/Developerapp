import type { FinishCategory, StyleName } from "@/lib/types";

export interface RoomTask {
  id: string;
  title: string;
  due_date: string | null;
  done: boolean;
}

export interface RoomFinish {
  id: string;
  name: string;
  category: FinishCategory;
  brand: string | null;
  price: number | null;
}

export interface RoomRendering {
  id: string;
  style: StyleName;
  colors: string[];
  description: string | null;
  image_prompt: string | null;
  midjourney_prompt: string | null;
  illustration_svg: string | null;
  uploaded_photo_url: string | null;
  created_at: string;
}

export interface RoughInMedia {
  id: string;
  media_type: "photo" | "video";
  storage_url: string;
  file_name: string | null;
  created_at: string;
}

// One pre-drywall documentation pass on this room — a set of photos/video
// plus which trades' rough-in it covers, taken once framing/rough
// plumbing/rough electrical are done and before drywall closes it up.
export interface RoughInCapture {
  id: string;
  room_label: string;
  trades: string[];
  notes: string | null;
  created_at: string;
  rough_in_media: RoughInMedia[];
}

// A construction's Plan tab layout page — used to ground AI room-image
// generation in the room's real wall/window/door layout instead of
// inventing one from a text description alone. See RenderingPanel.
export interface PlanPageOption {
  label: string;
  storage_url: string;
}

export interface RoomWithRelations {
  id: string;
  name: string;
  type: string | null;
  width: number | null;
  depth: number | null;
  floor: number | null;
  estimated: boolean;
  tasks: RoomTask[];
  finishes: RoomFinish[];
  renderings: RoomRendering[];
  rough_in_captures: RoughInCapture[];
}
