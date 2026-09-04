"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// Mounted once in the project layout, wrapping {children}. Nav links to
// disallowed tabs are already hidden (see ProjectTabs), but this catches
// someone navigating to a disallowed tab's URL directly (a stale link, a
// bookmark, or a role change while a tab was open) and bounces them to a
// tab they do have access to.
export function TabAccessGuard({
  projectId,
  allowedSlugs,
  children,
}: {
  projectId: string;
  allowedSlugs: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const slug = pathname?.split("/")[3];
  const allowed = !slug || allowedSlugs.includes(slug);

  useEffect(() => {
    if (!allowed) {
      router.replace(allowedSlugs.length > 0 ? `/projects/${projectId}/${allowedSlugs[0]}` : "/projects");
    }
  }, [allowed, allowedSlugs, projectId, router]);

  if (!allowed) {
    return <div className="p-8 text-center text-sm text-blueprint/50">You don&apos;t have access to this tab.</div>;
  }

  return <>{children}</>;
}
