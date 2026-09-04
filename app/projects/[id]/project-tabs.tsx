"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PROJECT_TABS } from "@/lib/permissions";

export function ProjectTabs({ projectId, allowedSlugs }: { projectId: string; allowedSlugs: string[] }) {
  const pathname = usePathname();
  const tabs = PROJECT_TABS.filter((t) => allowedSlugs.includes(t.slug));

  return (
    <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6">
      {tabs.map((tab) => {
        const href = `/projects/${projectId}/${tab.slug}`;
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={tab.slug}
            href={href}
            className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              active
                ? "border-amber text-blueprint-dark"
                : "border-transparent text-blueprint/50 hover:text-blueprint"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
