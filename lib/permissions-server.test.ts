import { describe, expect, it, vi } from "vitest";

// getAllowedTabSlugs only ever touches supabase.from("tab_permissions")...,
// never next/headers directly, so a minimal chainable mock of createClient()
// is enough — no need to mock next/headers itself.
function mockSupabaseWith(data: { tab: string; allowed: boolean }[] | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data }),
        }),
      }),
    }),
  };
}

describe("getAllowedTabSlugs", () => {
  it("returns every tab for the developer role without querying the DB", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createClient: () => mockSupabaseWith(null) }));
    const { getAllowedTabSlugs } = await import("./permissions-server");

    const tabs = [
      { slug: "plan", label: "Plan" },
      { slug: "chat", label: "Chat" },
    ];
    expect(await getAllowedTabSlugs("developer", tabs)).toEqual(["plan", "chat"]);
  });

  it("filters out tabs explicitly marked disallowed", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: () =>
        mockSupabaseWith([
          { tab: "plan", allowed: true },
          { tab: "chat", allowed: false },
        ]),
    }));
    const { getAllowedTabSlugs } = await import("./permissions-server");

    const tabs = [
      { slug: "plan", label: "Plan" },
      { slug: "chat", label: "Chat" },
    ];
    expect(await getAllowedTabSlugs("warranty", tabs)).toEqual(["plan"]);
  });

  it("fails closed (denies every tab) when the query returns an empty result", async () => {
    // Regression test: the original code was `if (!data) return
    // tabs.map(...)`, which doesn't catch `data` being `[]` — a truthy
    // empty array — so a role with zero configured tab_permissions rows
    // (a missed/unrun seeding migration) silently got full access instead
    // of none. `data: []` here simulates exactly that DB state.
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createClient: () => mockSupabaseWith([]) }));
    const { getAllowedTabSlugs } = await import("./permissions-server");

    const tabs = [
      { slug: "plan", label: "Plan" },
      { slug: "chat", label: "Chat" },
    ];
    expect(await getAllowedTabSlugs("warranty", tabs)).toEqual([]);
  });

  it("fails closed (denies every tab) when the query returns null (an error)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createClient: () => mockSupabaseWith(null) }));
    const { getAllowedTabSlugs } = await import("./permissions-server");

    const tabs = [{ slug: "plan", label: "Plan" }];
    expect(await getAllowedTabSlugs("owner", tabs)).toEqual([]);
  });
});
