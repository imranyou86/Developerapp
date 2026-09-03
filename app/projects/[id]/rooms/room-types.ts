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
  illustration_svg: string | null;
  uploaded_photo_url: string | null;
  created_at: string;
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
}
