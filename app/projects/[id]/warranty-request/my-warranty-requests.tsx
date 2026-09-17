"use client";

import { useState } from "react";
import {
  WarrantyRequestCard,
  type InspectionReportRow,
  type SubcontractorOption,
} from "@/app/projects/[id]/warranty-request/warranty-request-client";
import type { WarrantyItemRequest, WarrantyItemRequestComment } from "@/lib/types";

// Read-only tracking for the 'warranty' role's own filed requests — status,
// progress, assigned subcontractor, and the comment thread a Contractor/
// Developer/PM leaves on it, plus the ability to attach more evidence to a
// request already filed (WarrantyRequestCard's "+ Attach report" is
// unconditional, matching addInspectionReport's own carve-out for the
// account that filed the request). Every mutation handler besides the
// upload one is a no-op — WarrantyRequestCard already hides every control
// that would call them once canManageRequests is false, so they're never
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

  if (requests.length === 0) return null;

  const noop = async () => {};

  return (
    <div className="card p-5">
      <h2 className="mb-1 font-semibold text-blueprint-dark">Your Warranty Requests</h2>
      <p className="mb-4 text-sm text-blueprint/60">Here&apos;s what you&apos;ve filed and where it stands.</p>
      <div className="space-y-3">
        {requests.map((request) => (
          <WarrantyRequestCard
            key={request.id}
            projectId={projectId}
            request={request}
            comments={comments.filter((c) => c.request_id === request.id)}
            reports={reports.filter((r) => r.warranty_item_request_id === request.id)}
            subcontractors={subcontractors}
            canManageRequests={false}
            currentUserId={currentUserId}
            onApprove={noop}
            onReject={noop}
            onSetProgress={noop}
            onAssignSubcontractor={noop}
            onAddComment={noop}
            onDeleteComment={noop}
            onReportAdd={(r) => setReports((prev) => [r, ...prev])}
          />
        ))}
      </div>
    </div>
  );
}
