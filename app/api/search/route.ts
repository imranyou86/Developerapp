import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export interface SearchResult {
  type: "project" | "checklist_item" | "warranty_item" | "room" | "task" | "bid" | "payment_item" | "subcontractor" | "deal";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

const MIN_QUERY_LENGTH = 2;
const PER_CATEGORY_LIMIT = 8;

// Every table here is queried with the caller's own session client, not the
// admin client — each table's existing RLS (has_project_access, the
// subcontractors shared-directory policy, deals' auth.uid() = user_id)
// already scopes results to exactly what this user can see, so there's no
// separate authorization step needed here.
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Real stored role, not a Developer's preview one — this is the actual
  // authorization boundary (the page-level redirect in app/search/page.tsx
  // is just the normal-navigation UX for it, and deliberately does use the
  // preview-aware role so "Preview as Warranty" shows the real experience).
  // No 'warranty' account should be able to reach this by hitting the API
  // directly either — it surfaces bids, payments, subcontractors, nothing
  // a homeowner account needs.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "warranty") return NextResponse.json({ error: "Not available for this account." }, { status: 403 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_QUERY_LENGTH) return NextResponse.json({ results: [] });

  // Escape ilike's own wildcards so a literal "%" or "_" the user types is
  // searched for as text rather than acting as a pattern wildcard.
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;

  // Each of these matches on more than one column. `.or()` takes a single
  // PostgREST filter string where commas separate conditions, so a search
  // term containing a literal comma (still possible even after escaping
  // ilike's own wildcards above) would corrupt that string and silently
  // break the filter — querying each column separately and merging by id
  // sidesteps that entirely.
  async function searchAnyColumn<T extends { id: string }>(table: string, columns: string[], select: string): Promise<T[]> {
    const byId = new Map<string, T>();
    await Promise.all(
      columns.map(async (col) => {
        const { data } = await supabase.from(table).select(select).ilike(col, pattern).limit(PER_CATEGORY_LIMIT);
        for (const row of (data ?? []) as unknown as T[]) byId.set(row.id, row);
      })
    );
    return Array.from(byId.values()).slice(0, PER_CATEGORY_LIMIT);
  }

  const [projects, checklistItems, rooms, tasks, bids, paymentItems, subcontractors, deals] = await Promise.all([
    searchAnyColumn<{ id: string; name: string; address: string | null }>("projects", ["name", "address"], "id, name, address"),
    supabase
      .from("checklist_items")
      .select("id, project_id, phase, title, projects(name)")
      .ilike("title", pattern)
      .limit(PER_CATEGORY_LIMIT),
    supabase.from("rooms").select("id, project_id, name, projects(name)").ilike("name", pattern).limit(PER_CATEGORY_LIMIT),
    supabase
      .from("tasks")
      .select("id, title, rooms(project_id, name, projects(name))")
      .ilike("title", pattern)
      .limit(PER_CATEGORY_LIMIT),
    supabase.from("bids").select("id, project_id, contractor, projects(name)").ilike("contractor", pattern).limit(PER_CATEGORY_LIMIT),
    supabase
      .from("payment_schedule_items")
      .select("id, label, bids(project_id, contractor, projects(name))")
      .ilike("label", pattern)
      .limit(PER_CATEGORY_LIMIT),
    searchAnyColumn<{ id: string; company_name: string; trade: string | null; contact_name: string | null }>(
      "subcontractors",
      ["company_name", "trade", "contact_name"],
      "id, company_name, trade, contact_name"
    ),
    supabase.from("deals").select("id, address, city, state").ilike("address", pattern).limit(PER_CATEGORY_LIMIT),
  ]);

  const results: SearchResult[] = [];

  for (const p of projects) {
    results.push({ type: "project", id: p.id, title: p.name, subtitle: p.address, href: `/projects/${p.id}/plan` });
  }

  // Nested embeds (`projects(name)`, `rooms(...)`) are typed as arrays here
  // — without a generated Database type, postgrest-js can't know these are
  // actually one-to-one foreign keys, so it falls back to its default
  // to-many shape. Each is really at most one row; `?.[0]` reflects that.
  interface WithProjectName {
    id: string;
    project_id: string;
    title?: string;
    name?: string;
    phase?: string;
    contractor?: string;
    projects: { name: string }[] | null;
  }

  for (const c of ((checklistItems.data ?? []) as unknown as WithProjectName[])) {
    const isWarranty = c.phase === "warranty";
    results.push({
      type: isWarranty ? "warranty_item" : "checklist_item",
      id: c.id,
      title: c.title!,
      subtitle: c.projects?.[0]?.name ?? null,
      href: `/projects/${c.project_id}/${isWarranty ? "warranty-request" : "checklist"}`,
    });
  }

  for (const r of ((rooms.data ?? []) as unknown as WithProjectName[])) {
    results.push({ type: "room", id: r.id, title: r.name!, subtitle: r.projects?.[0]?.name ?? null, href: `/projects/${r.project_id}/rooms` });
  }

  for (const t of (tasks.data ?? []) as unknown as {
    id: string;
    title: string;
    rooms: { project_id: string; name: string; projects: { name: string }[] | null }[] | null;
  }[]) {
    const room = t.rooms?.[0];
    if (!room) continue;
    results.push({
      type: "task",
      id: t.id,
      title: t.title,
      subtitle: [room.name, room.projects?.[0]?.name].filter(Boolean).join(" — "),
      href: `/projects/${room.project_id}/rooms`,
    });
  }

  for (const b of ((bids.data ?? []) as unknown as WithProjectName[])) {
    results.push({ type: "bid", id: b.id, title: b.contractor!, subtitle: b.projects?.[0]?.name ?? null, href: `/projects/${b.project_id}/bids` });
  }

  for (const l of (paymentItems.data ?? []) as unknown as {
    id: string;
    label: string;
    bids: { project_id: string; contractor: string; projects: { name: string }[] | null }[] | null;
  }[]) {
    const bid = l.bids?.[0];
    if (!bid) continue;
    results.push({
      type: "payment_item",
      id: l.id,
      title: l.label,
      subtitle: [bid.contractor, bid.projects?.[0]?.name].filter(Boolean).join(" — "),
      href: `/projects/${bid.project_id}/payments`,
    });
  }

  for (const s of subcontractors) {
    results.push({
      type: "subcontractor",
      id: s.id,
      title: s.company_name,
      subtitle: [s.trade, s.contact_name].filter(Boolean).join(" — ") || null,
      href: `/subcontractors`,
    });
  }

  for (const d of (deals.data ?? []) as unknown as { id: string; address: string; city: string | null; state: string | null }[]) {
    results.push({
      type: "deal",
      id: d.id,
      title: d.address,
      subtitle: [d.city, d.state].filter(Boolean).join(", ") || null,
      href: `/deals/${d.id}`,
    });
  }

  return NextResponse.json({ results });
}
