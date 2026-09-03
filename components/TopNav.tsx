"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/projects", label: "Constructions" },
  { href: "/deals", label: "Buyers Guide" },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-6">
      {TABS.map((tab) => {
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
