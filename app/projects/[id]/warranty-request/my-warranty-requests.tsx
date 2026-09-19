"use client";

import { useState } from "react";
import {
  GroupedRequestCards,
  type InspectionReportRow,
  type SubcontractorOption,
} from "@/app/projects/[id]/warranty-request/warranty-request-client";
import type { WarrantyItemRequest, WarrantyItemRequestComment } from "@/lib/types";
import { useScrollToHash } from "@/lib/useScrollToHash";

// Read-only tracking for the 'warranty' role — every request filed on this
// construction, not just ones this account filed itself (see migration
// 058: two warranty accounts on the same construction share one queue),
// organized into the same trade sections the Contractor/Developer/PM
// dashboard uses (GroupedRequestCards), showing status, progress, assigned
// subcontractor, and the comment thread a Contractor/Developer/PM leaves on
// each one, plus the ability to attach more evidence to any request here
// (WarrantyRequestCard's "+ Attach report" is unconditional). Every
// mutation handler besides the upload one is a no-op — canManageRequests=
// false already hides every control that would call them, so they're never
// actually invoked from here.
export function MyWarrantyRequests({
  projectId,
  requests,
  comments,
  initialReports,
  subcontractors,
  currentUserId,
}: {
  projectId: string;
  requests: WarrantyItemRequest[];
  comments: WarrantyItemRequestComment[];
  initialReports: InspectionReportRow[];
  subcontractors: SubcontractorOption[];
  currentUserId: string | null;
}) {
  const [reports, setReports] = useState<InspectionReportRow[]>(initialReports);
  // Lands the viewer on a specific request/group when arriving from a
  // Calendar warranty-visit link (`#wr-<id>`) — this component only ever
  // mounts once WarrantyHomeownerTabs has switched to the "Track" tab, so
  // its own mount is exactly the right moment to run this.
  useScrollToHash();

  if (requests.length === 0) return null;

  const noop = async () => {};

  return (
    <div className="card p-5">
      <h2 className="mb-1 font-semibold text-blueprint-dark">Warranty Requests</h2>
      <p className="mb-4 text-sm text-blueprint/60">Everything filed for this construction and where it stands.</p>
      <GroupedRequestCards
        projectId={projectId}
        requests={requests}
        comments={comments}
        reports={reports}
        subcontractors={subcontractors}
        canManageRequests={false}
        canDeleteRequests={false}
        currentUserId={currentUserId}
        onApprove={noop}
        onReject={noop}
        onSetProgress={noop}
        onAssignSubcontractor={noop}
        onSetSchedule={noop}
        onUpdateCategory={noop}
        onAddComment={noop}
        onDeleteComment={noop}
        onReportAdd={(r) => setReports((prev) => [r, ...prev])}
      />
    </div>
  );
}
