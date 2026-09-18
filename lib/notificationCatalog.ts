import type { UserRole } from "@/lib/types";

// Client-safe: the canonical list of every event that can trigger a
// project notification (email and/or push, per lib/alerts.ts), shown on
// the Admin page's Notifications section and used to seed
// notification_settings for a fresh install (see supabase/schema.sql).
// Keep this in sync with the notifyForAction(...) call sites in
// app/projects/[id]/chat/actions.ts, .../checklist/actions.ts, and
// .../warranty-request/actions.ts — every `key` here must match an
// `action` string passed to notifyForAction there, and vice versa.
export interface NotificationActionDef {
  key: string;
  label: string;
  description: string;
  // Roles force-notified for this action regardless of whether they've
  // personally clicked "Get alerts" on that construction — empty means
  // purely opt-in (the behavior every action had before this setting
  // existed). Anyone who HAS clicked "Get alerts" always gets it too,
  // whatever this list says; roles here only ever add recipients, never
  // remove the ones a user chose for themselves.
  defaultRoles: UserRole[];
}

export const NOTIFICATION_ACTIONS: NotificationActionDef[] = [
  {
    key: "chat_message",
    label: "New chat message",
    description: "Someone sends a message in a construction's Chat tab.",
    defaultRoles: [],
  },
  {
    key: "checklist_item_added",
    label: "New checklist item",
    description: "A rough-in/finish checklist item is added.",
    defaultRoles: [],
  },
  {
    key: "checklist_item_done",
    label: "Checklist item marked done",
    description: "A checklist item (or a bulk selection) is marked done.",
    defaultRoles: [],
  },
  {
    key: "warranty_item_added",
    label: "New warranty item",
    description: "A Contractor, Developer, or PM adds a warranty item directly.",
    defaultRoles: [],
  },
  {
    key: "warranty_item_done",
    label: "Warranty item marked fixed",
    description: "A warranty item (or a bulk selection) is marked fixed.",
    defaultRoles: [],
  },
  {
    key: "warranty_item_status_changed",
    label: "Warranty item status changed",
    description: "A warranty item is validated or marked not covered by warranty.",
    defaultRoles: [],
  },
  {
    key: "warranty_items_from_report",
    label: "Warranty items added from an inspection report",
    description: "AI-extracted warranty items are bulk-added from an uploaded inspection report.",
    defaultRoles: [],
  },
  {
    key: "warranty_request_submitted",
    label: "New warranty request submitted",
    description: "A homeowner (Warranty role) files a new warranty item request awaiting review.",
    defaultRoles: ["contractor", "developer"],
  },
  {
    key: "warranty_request_approved",
    label: "Warranty request approved",
    description: "A filed warranty request is approved and added to the warranty list.",
    defaultRoles: [],
  },
  {
    key: "warranty_request_rejected",
    label: "Warranty request rejected",
    description: "A filed warranty request is rejected.",
    defaultRoles: [],
  },
  {
    key: "warranty_request_status_changed",
    label: "Warranty request status changed",
    description: "A warranty request's progress (e.g. scheduled, in progress) changes.",
    defaultRoles: [],
  },
  {
    key: "warranty_request_comment",
    label: "New comment on a warranty request",
    description: "Someone comments on a warranty request.",
    defaultRoles: [],
  },
];
