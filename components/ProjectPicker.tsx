"use client";

import { useRouter } from "next/navigation";

interface ProjectOption {
  id: string;
  name: string;
  address: string | null;
}

// Shared by every top-level (not per-project) section that still needs to
// scope its data to one construction — Interior Design and Construction
// Cost so far. `basePath` is the section's own route (e.g.
// "/interior-design"), used to build the `?project=` navigation.
export function ProjectPicker({
  projects,
  selectedId,
  basePath,
}: {
  projects: ProjectOption[];
  selectedId: string | null;
  basePath: string;
}) {
  const router = useRouter();

  return (
    <select
      className="input w-auto"
      value={selectedId ?? ""}
      onChange={(e) => router.push(e.target.value ? `${basePath}?project=${e.target.value}` : basePath)}
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
