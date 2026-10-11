"use client";

import { useState } from "react";
import { ProjectPicker } from "@/components/ProjectPicker";
import { InteriorDesignClient } from "@/app/interior-design/interior-design-client";
import { FinishIdClient } from "@/app/interior-design/finish-id-client";
import { MoodBoardClient } from "@/app/interior-design/mood-board-client";
import type { InteriorDesign, IdentifiedFinish, MoodBoard } from "@/lib/types";

interface ProjectOption {
  id: string;
  name: string;
  address: string | null;
}

interface RoomOption {
  id: string;
  name: string;
  type: string | null;
  width: number | null;
  depth: number | null;
}

interface PlanPageOption {
  label: string;
  storage_url: string;
}

interface FinishScanRow {
  id: string;
  storage_url: string;
  label: string | null;
  results: IdentifiedFinish[];
  created_at: string;
}

const TABS = [
  { id: "design", label: "Design a room" },
  { id: "mood-boards", label: "Mood Boards" },
  { id: "finish-id", label: "Finish ID" },
] as const;

// A "Design" tab and a "Mood Boards" tab (both need a selected construction,
// so both keep the project picker) and a "Finish ID" tab (universal — works
// regardless of which, if any, construction is picked above) living on the
// same top-level page.
export function InteriorDesignSections({
  projectList,
  selectedId,
  selectedProject,
  rooms,
  designs,
  planPages,
  scans,
  moodBoards,
  roomsByProject,
}: {
  projectList: ProjectOption[];
  selectedId: string | null;
  selectedProject: ProjectOption | null;
  rooms: RoomOption[];
  designs: InteriorDesign[];
  planPages: PlanPageOption[];
  scans: FinishScanRow[];
  moodBoards: MoodBoard[];
  roomsByProject: Record<string, { id: string; name: string }[]>;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("design");

  const needsProjectPicker = tab === "design" || tab === "mood-boards";

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

      {needsProjectPicker && (
        <>
          <p className="mb-3 text-sm text-blueprint/50">
            {tab === "design"
              ? "Pick which construction this design is for — sizing can come from that project's pre-added rooms."
              : "Pick which construction this mood board is for — one board per room, built from that room's pre-added list."}
          </p>
          {projectList.length === 0 ? (
            <p className="text-sm text-blueprint/50">
              No constructions yet — create one under Constructions first, then come back here.
            </p>
          ) : (
            <div className="mb-6">
              <ProjectPicker projects={projectList} selectedId={selectedId} basePath="/interior-design" />
            </div>
          )}
        </>
      )}

      {tab === "design" ? (
        selectedId && (
          <InteriorDesignClient key={selectedId} projectId={selectedId} initialDesigns={designs} rooms={rooms} planPages={planPages} />
        )
      ) : tab === "mood-boards" ? (
        selectedId &&
        selectedProject && (
          <MoodBoardClient
            key={selectedId}
            projectId={selectedId}
            projectName={selectedProject.name}
            projectAddress={selectedProject.address}
            rooms={rooms}
            initialBoards={moodBoards}
          />
        )
      ) : (
        <FinishIdClient projects={projectList} roomsByProject={roomsByProject} initialScans={scans} />
      )}
    </div>
  );
}
