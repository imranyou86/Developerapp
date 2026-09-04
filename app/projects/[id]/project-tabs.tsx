"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PROJECT_TABS } from "@/lib/permissions";

export function ProjectTabs({ projectId, allowedSlugs }: { projectId: string; allowedSlugs: string[] }) {
  const pathname = usePathname();
  const tabs = PROJECT_TABS.filter((t) => allowedSlugs.includes(t.slug));

  return (
    <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 pb-3">
      {tabs.map((tab) => {
        const href = `/projects/${projectId}/${tab.slug}`;
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={tab.slug}
            href={href}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
              active
                ? "bg-blueprint text-white shadow-sm"
                : "text-blueprint/60 hover:bg-blueprint/5 hover:text-blueprint-dark"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
