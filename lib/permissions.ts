import type { UserRole } from "@/lib/types";

// Client-safe constants only — no server-only imports here. Server-side
// helpers (getCurrentUser, getAllowedTabSlugs) live in
// lib/permissions-server.ts so client components can still import the
// shared constants below without pulling in next/headers.

export const ROLE_VALUES: UserRole[] = ["owner", "pm", "contractor", "developer"];

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  pm: "PM",
  contractor: "Contractor",
  developer: "Developer",
};

export interface ProjectTabDef {
  slug: string;
  label: string;
}

// Shared with app/projects/[id]/project-tabs.tsx — keep slugs in sync with
// the tab_permissions check constraint in supabase/schema.sql.
export const PROJECT_TABS: ProjectTabDef[] = [
  { slug: "plan", label: "Plan" },
  { slug: "rooms", label: "Rooms & Tasks" },
  { slug: "finish-id", label: "Finish ID" },
  { slug: "checklist", label: "Checklist" },
  { slug: "budget", label: "Budget" },
  { slug: "cost", label: "Construction Cost" },
  { slug: "payments", label: "Payments" },
  { slug: "files", label: "Files" },
];

export interface CurrentUser {
  id: string;
  email: string | null;
  role: UserRole;
}
