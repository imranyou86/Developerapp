"use client";

import { useState } from "react";
import { ProjectPicker } from "@/components/ProjectPicker";
import { LandscapeClient } from "@/app/landscape/landscape-client";
import type { LandscapeDesign } from "@/lib/types";

interface ProjectOption {
  id: string;
  name: string;
  address: string | null;
}

const TABS = [
  { id: "construction", label: "By Construction" },
  { id: "standalone", label: "Standalone Photos" },
] as const;

// "By Construction" needs a project picked (and keeps its designs scoped to
// that construction); "Standalone Photos" is for a photo that isn't tied to
// any tracked construction at all — a listing you're scouting, a random
// exterior shot — so it skips the picker entirely.
export function LandscapeSections({
  projectList,
  selectedId,
  designs,
  standaloneDesigns,
}: {
  projectList: ProjectOption[];
  selectedId: string | null;
  designs: LandscapeDesign[];
  standaloneDesigns: LandscapeDesign[];
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("construction");

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-blueprint/10">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? "border-amber text-amber-dark" : "border-transparent text-blueprint/50 hover:text-blueprint-dark"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "construction" ? (
        <>
          <p className="mb-3 text-sm text-blueprint/50">
            Pick which construction this design is for — upload a photo of the house&apos;s exterior and OpenAI will
            redesign the actual yard around it.
          </p>
          {projectList.length === 0 ? (
            <p className="text-sm text-blueprint/50">
              No constructions yet — create one under Constructions first, then come back here.
            </p>
          ) : (
            <div className="mb-6">
              <ProjectPicker projects={projectList} selectedId={selectedId} basePath="/landscape" />
            </div>
          )}
          {selectedId && <LandscapeClient key={selectedId} projectId={selectedId} initialDesigns={designs} />}
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-blueprint/50">
            For a photo that isn&apos;t tied to any of your constructions — a listing you&apos;re scouting, a reference
            photo, anything else. Visible to anyone signed in; only you (or a Developer) can delete one.
          </p>
          <LandscapeClient key="standalone" projectId={null} initialDesigns={standaloneDesigns} />
        </>
      )}
    </div>
  );
}
