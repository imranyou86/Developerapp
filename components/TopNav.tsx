"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/projects", label: "Constructions" },
  { href: "/deals", label: "Buyers Guide" },
];

export function TopNav({ showAdmin }: { showAdmin?: boolean } = {}) {
  const pathname = usePathname();
  const tabs = showAdmin ? [...TABS, { href: "/admin", label: "Admin" }] : TABS;

  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-6">
      {tabs.map((tab) => {
        const active = pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
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
