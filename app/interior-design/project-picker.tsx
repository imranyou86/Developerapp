"use client";

import { useRouter } from "next/navigation";

interface ProjectOption {
  id: string;
  name: string;
  address: string | null;
}

export function ProjectPicker({ projects, selectedId }: { projects: ProjectOption[]; selectedId: string | null }) {
  const router = useRouter();

  return (
    <select
      className="input w-auto"
      value={selectedId ?? ""}
      onChange={(e) => router.push(e.target.value ? `/interior-design?project=${e.target.value}` : "/interior-design")}
    >
      <option value="">Select a construction…</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.address ? ` — ${p.address}` : ""}
        </option>
      ))}
    </select>
  );
}
