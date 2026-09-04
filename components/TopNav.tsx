"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TopNav({
  showAdmin,
  showDeals = true,
  showInteriorDesign = true,
}: {
  showAdmin?: boolean;
  showDeals?: boolean;
  showInteriorDesign?: boolean;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: "/projects", label: "Constructions" },
    ...(showDeals ? [{ href: "/deals", label: "Buyers Guide" }] : []),
    ...(showInteriorDesign ? [{ href: "/interior-design", label: "Interior Design" }] : []),
    ...(showAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

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
