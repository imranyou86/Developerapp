"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { setPreviewRole } from "@/app/admin/preview-actions";
import { ROLE_LABELS } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

const PREVIEWABLE_ROLES: UserRole[] = ["owner", "pm", "contractor"];

export function TopNav({
  showAdmin,
  showDeals = true,
  isDeveloper,
  previewRole,
}: {
  showAdmin?: boolean;
  showDeals?: boolean;
  /** True account role is Developer, regardless of any active preview — controls whether the picker below shows at all. */
  isDeveloper?: boolean;
  /** The role currently being previewed, if any (undefined/"developer" = no preview). */
  previewRole?: UserRole;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const tabs = [
    { href: "/projects", label: "Constructions" },
    ...(showDeals ? [{ href: "/deals", label: "Buyers Guide" }] : []),
    ...(showAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  function handlePreviewChange(value: string) {
    startTransition(async () => {
      await setPreviewRole(value === "developer" ? null : (value as UserRole));
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex max-w-5xl items-center justify-between px-6">
      <nav className="flex gap-1 overflow-x-auto">
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

      {isDeveloper && (
        <div className="flex shrink-0 items-center gap-2 py-2">
          {previewRole && previewRole !== "developer" && (
            <span className="badge-amber text-xs">Previewing as {ROLE_LABELS[previewRole]}</span>
          )}
          <select
            className="input w-auto py-1 text-xs"
            value={previewRole && previewRole !== "developer" ? previewRole : "developer"}
            disabled={pending}
            onChange={(e) => handlePreviewChange(e.target.value)}
          >
            <option value="developer">Preview as…</option>
            {PREVIEWABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
