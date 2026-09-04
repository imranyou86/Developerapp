"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TopNav({
  showAdmin,
  showDeals = true,
  showInteriorDesign = true,
  showSubcontractors = true,
}: {
  showAdmin?: boolean;
  showDeals?: boolean;
  showInteriorDesign?: boolean;
  showSubcontractors?: boolean;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: "/projects", label: "Constructions" },
    ...(showDeals ? [{ href: "/deals", label: "Buyers Guide" }] : []),
    ...(showInteriorDesign ? [{ href: "/interior-design", label: "Interior Design" }] : []),
    ...(showSubcontractors ? [{ href: "/subcontractors", label: "Subcontractors" }] : []),
    ...(showAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-6 pb-3">
      {tabs.map((tab) => {
        const active = pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
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
