"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { slug: "plan", label: "Plan" },
  { slug: "rooms", label: "Rooms & Tasks" },
  { slug: "finish-id", label: "Finish ID" },
  { slug: "checklist", label: "Checklist" },
  { slug: "budget", label: "Budget" },
  { slug: "payments", label: "Payments" },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();

  return (
    <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6">
      {TABS.map((tab) => {
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
