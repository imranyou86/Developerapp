"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatTimeWindow } from "@/lib/timeFormat";

export interface CalendarEntry {
  id: string;
  kind: "task" | "warranty_visit";
  title: string;
  dueDate: string;
  timeStart: string | null;
  timeEnd: string | null;
  subLabel: string;
  projectId: string;
  href: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

function formatDueDate(dueDate: string): string {
  // Parsed as a plain calendar date (no time/timezone component) rather
  // than handed straight to `new Date(dueDate)` — that treats a bare
  // "YYYY-MM-DD" as UTC midnight, which can display as the previous day
  // in a negative UTC offset.
  const [y, m, d] = dueDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function CalendarClient({ entries, projects }: { entries: CalendarEntry[]; projects: ProjectOption[] }) {
  const [filterProjectId, setFilterProjectId] = useState<string>("");

  // Compared as ISO date strings (which sort correctly lexicographically)
  // rather than Date objects, sidestepping the same UTC-midnight parsing
  // issue noted in formatDueDate above.
  const { todayStr, weekAheadStr } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAhead = new Date(today);
    weekAhead.setDate(weekAhead.getDate() + 7);
    const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { todayStr: toIso(today), weekAheadStr: toIso(weekAhead) };
  }, []);

  const filtered = filterProjectId ? entries.filter((e) => e.projectId === filterProjectId) : entries;

  const overdue = filtered.filter((e) => e.dueDate < todayStr);
  const thisWeek = filtered.filter((e) => e.dueDate >= todayStr && e.dueDate < weekAheadStr);
  const later = filtered.filter((e) => e.dueDate >= weekAheadStr);

  const groups = (
    [
      { label: "Overdue", tone: "danger", items: overdue },
      { label: "Due this week", tone: "warn", items: thisWeek },
      { label: "Later", tone: "neutral", items: later },
    ] as { label: string; tone: "danger" | "warn" | "neutral"; items: CalendarEntry[] }[]
  ).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      <select className="input w-auto" value={filterProjectId} onChange={(e) => setFilterProjectId(e.target.value)}>
        <option value="">All constructions</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {groups.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">
          Nothing due or scheduled{filterProjectId ? " for this construction" : ""}.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label}>
            <p
              className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${
                group.tone === "danger" ? "text-red-600" : group.tone === "warn" ? "text-amber-dark" : "text-blueprint/50"
              }`}
            >
              {group.label} ({group.items.length})
            </p>
            <div className="card divide-y divide-blueprint/10">
              {group.items.map((entry) => {
                const timeWindow = formatTimeWindow(entry.timeStart, entry.timeEnd);
                return (
                  <Link
                    key={entry.id}
                    href={entry.href}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-concrete"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-blueprint-dark">
                        {entry.kind === "warranty_visit" && <span className="mr-1">🔧</span>}
                        {entry.title}
                      </p>
                      <p className="truncate text-xs text-blueprint/50">{entry.subLabel}</p>
                    </div>
                    <span
                      className={`shrink-0 text-xs font-medium ${
                        group.tone === "danger" ? "text-red-600" : group.tone === "warn" ? "text-amber-dark" : "text-blueprint/50"
                      }`}
                    >
                      {formatDueDate(entry.dueDate)}
                      {timeWindow && `, ${timeWindow}`}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
