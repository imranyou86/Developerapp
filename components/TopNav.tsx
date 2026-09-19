"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLink {
  href: string;
  label: string;
}

export function TopNav({
  showAdmin,
  showSearch = true,
  showDeals = true,
  showInteriorDesign = true,
  showConstructionCost = true,
  showLandscape = true,
  showSubcontractors = true,
}: {
  showAdmin?: boolean;
  showSearch?: boolean;
  showDeals?: boolean;
  showInteriorDesign?: boolean;
  showConstructionCost?: boolean;
  showLandscape?: boolean;
  showSubcontractors?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  const flatLinks: NavLink[] = [
    { href: "/projects", label: "Constructions" },
    { href: "/calendar", label: "Calendar" },
    ...(showSearch ? [{ href: "/search", label: "Search" }] : []),
  ];

  // Grouped under one dropdown rather than five flat tabs — same reasoning
  // as the per-project tab strip's PROJECT_NAV grouping.
  const groupLinks: NavLink[] = [
    ...(showDeals ? [{ href: "/deals", label: "Buyers Guide" }] : []),
    ...(showInteriorDesign ? [{ href: "/interior-design", label: "Interior Design" }] : []),
    ...(showConstructionCost ? [{ href: "/construction-cost", label: "Construction Cost" }] : []),
    ...(showLandscape ? [{ href: "/landscape", label: "Landscape" }] : []),
    ...(showSubcontractors ? [{ href: "/subcontractors", label: "Subcontractors" }] : []),
  ];
  const groupActive = groupLinks.some((l) => pathname?.startsWith(l.href));

  function linkClass(active: boolean) {
    return `whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
      active ? "bg-blueprint text-white shadow-sm" : "text-blueprint/60 hover:bg-blueprint/5 hover:text-blueprint-dark"
    }`;
  }

  return (
    <nav ref={navRef} className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-6 pb-3">
      {flatLinks.map((link) => (
        <Link key={link.href} href={link.href} className={linkClass(!!pathname?.startsWith(link.href))}>
          {link.label}
        </Link>
      ))}

      {groupLinks.length === 1 ? (
        <Link href={groupLinks[0].href} className={linkClass(!!pathname?.startsWith(groupLinks[0].href))}>
          {groupLinks[0].label}
        </Link>
      ) : groupLinks.length > 1 ? (
        <div className="relative">
          <button type="button" onClick={() => setOpen((o) => !o)} className={`flex items-center gap-1 ${linkClass(groupActive)}`}>
            Design &amp; Tools
            <span className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
          </button>
          {open && (
            <div
              className="animate-fade-in absolute left-0 top-full z-20 mt-1 min-w-[10rem] rounded-lg border border-blueprint/10 bg-white py-1 shadow-elevated"
              onClick={(e) => e.stopPropagation()}
            >
              {groupLinks.map((link) => {
                const active = pathname?.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`block px-3 py-2 text-sm transition-colors ${
                      active ? "bg-blueprint/10 font-medium text-blueprint-dark" : "text-blueprint/70 hover:bg-concrete hover:text-blueprint-dark"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {showAdmin && (
        <Link href="/admin" className={linkClass(!!pathname?.startsWith("/admin"))}>
          Admin
        </Link>
      )}
    </nav>
  );
}
