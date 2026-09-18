"use client";

import { useState } from "react";
import { ProjectPicker } from "@/components/ProjectPicker";
import { CostClient } from "@/app/construction-cost/cost-client";
import type { CostEstimate, PlanPage } from "@/lib/types";

interface ProjectOption {
  id: string;
  name: string;
  address: string | null;
}

const TABS = [
  { id: "construction", label: "By Construction" },
  { id: "standalone", label: "Standalone Plan" },
] as const;

// "By Construction" needs a project picked (its plan pages live on that
// project's Plan tab too). "Standalone Plan" is for pricing a plan that
// isn't tied to any tracked construction at all — an addition, ADU,
// renovation, or anything else — so it skips the picker entirely and keeps
// its own private plan pages + estimate history.
export function CostSections({
  projectList,
  selectedId,
  projectAddress,
  planPages,
  roomsSqftHint,
  estimates,
  loadError,
  standalonePages,
  standaloneEstimates,
}: {
  projectList: ProjectOption[];
  selectedId: string | null;
  projectAddress: string | null;
  planPages: PlanPage[];
  roomsSqftHint: number | null;
  estimates: CostEstimate[];
  loadError: string | null;
  standalonePages: PlanPage[];
  standaloneEstimates: CostEstimate[];
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("construction");

  return (
    <div>
      <div className="mb-6">
        <h2 className="mb-1 text-lg font-semibold text-blueprint-dark">Construction Cost</h2>
        <p className="mb-3 text-sm text-blueprint/50">
          Upload a plan and get a cost estimate for any building project — a tracked construction, or a plan on
          its own for an addition, renovation, ADU, or anything else you&apos;re pricing.
        </p>
        <div className="flex gap-1 border-b border-blueprint/10">
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
      </div>

      {tab === "construction" ? (
        <>
          {projectList.length === 0 ? (
            <p className="text-sm text-blueprint/50">
              No constructions yet — create one under Constructions first, or use Standalone Plan above to price a
              plan on its own.
            </p>
          ) : (
            <div className="mb-6">
              <ProjectPicker projects={projectList} selectedId={selectedId} basePath="/construction-cost" />
            </div>
          )}
          {selectedId && (
            <>
              {loadError && (
                <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                  Could not load cost estimate history: {loadError}
                </div>
              )}
              <CostClient
                key={selectedId}
                projectId={selectedId}
                projectAddress={projectAddress}
                initialPlanPages={planPages}
                roomsSqftHint={roomsSqftHint}
                initialEstimates={estimates}
              />
            </>
          )}
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-blueprint/50">
            For a plan that isn&apos;t tied to any of your constructions. Private to you — upload the plan, add an
            optional label and location, and estimate.
          </p>
          <CostClient
            key="standalone"
            projectId={null}
            projectAddress={null}
            initialPlanPages={standalonePages}
            roomsSqftHint={null}
            initialEstimates={standaloneEstimates}
          />
        </>
      )}
    </div>
  );
}
