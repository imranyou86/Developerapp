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

// Top-level (not per-project) sections gated the same way as project tabs.
// Shared with components/TopNav.tsx, app/deals/layout.tsx, and
// app/interior-design/layout.tsx.
export const TOP_LEVEL_TABS: ProjectTabDef[] = [
  { slug: "deals", label: "Buyers Guide" },
  { slug: "interior-design", label: "Interior Design" },
  { slug: "subcontractors", label: "Subcontractors" },
];

export const ALL_TABS: ProjectTabDef[] = [...PROJECT_TABS, ...TOP_LEVEL_TABS];

export interface CurrentUser {
  id: string;
  email: string | null;
  /** Effective role — the previewed role while a Developer is previewing, otherwise the real one. */
  role: UserRole;
  /** The real, stored account role is "developer", regardless of any active preview. */
  isDeveloper: boolean;
}

// Cookie a Developer's "preview as" role picker writes/reads (see
// app/admin/preview-actions.ts + components/TopNav.tsx) — lets a Developer
// browse the app as Owner/PM/Contractor would see it (which tabs/pages
// render) without touching their real account role. It's a UI-only
// simulation: RLS and has_project_access() still check the real
// profiles.role, so a previewing Developer keeps full data access
// underneath regardless of what's shown.
export const PREVIEW_ROLE_COOKIE = "preview_role";
