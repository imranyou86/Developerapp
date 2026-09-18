"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { addInspectionReport, requestWarrantyItems } from "@/app/projects/[id]/warranty-request/actions";
import { extractFindingsFromReport, isExtractableReport } from "@/lib/inspectionReportExtraction";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";

// Lets a homeowner (the 'warranty' role) upload an inspection report they
// received themselves — read automatically with the same Claude extraction
// route the Contractor/Developer/PM dashboard uses, split into individual
// issues, classified by trade, and filed as pending requests (grouped into
// one ticket per trade when a report turns up more than one issue for it —
// see requestWarrantyItems) instead of retyping every finding by hand into
// the form below.
export function WarrantyInspectionUpload({ projectId }: { projectId: string }) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const taskKey = "warranty-inspection-upload";

  async function handleFile(file: File) {
    if (!isExtractableReport(file.name)) {
      notify("error", "Automatic extraction only works for PDF or photo reports.");
      return;
    }
    setUploading(true);
    try {
      await run(taskKey, `Reading "${file.name}"…`, async () => {
        setStatus("Uploading…");
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in.");

        const path = `${user.id}/${projectId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("project-files").upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
        if (uploadError) throw new Error(uploadError.message);

        const { data: pub, error: signError } = await supabase.storage
          .from("project-files")
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (signError || !pub) throw new Error(signError?.message ?? "Could not get a URL for the uploaded file.");

        const reportRes = await addInspectionReport(projectId, file.name, pub.signedUrl);
        if (!reportRes.ok) throw new Error(reportRes.error ?? "Could not save the report.");

        const findings = await extractFindingsFromReport(projectId, { file_name: file.name, storage_url: pub.signedUrl }, setStatus);
        if (findings.length === 0) {
          notify("success", `Uploaded "${file.name}" — no actionable issues found in it.`);
          return;
        }

        setStatus("Filing requests…");
        const submitRes = await requestWarrantyItems(
          projectId,
          findings.map((f) => ({ title: f.title, comment: f.detail, category: f.category }))
        );
        if (!submitRes.ok) throw new Error(submitRes.error ?? "Could not submit the requests found in this report.");

        notify(
          "success",
          `Found ${findings.length} issue${findings.length === 1 ? "" : "s"} in "${file.name}" and filed ${findings.length === 1 ? "it" : "them"} for review.`
        );
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not read this report.");
    } finally {
      setUploading(false);
      setStatus(null);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="mb-1 font-semibold text-blueprint-dark">Upload an Inspection Report</h2>
      <p className="mb-3 text-sm text-blueprint/60">
        Received an inspector&apos;s report? Upload it here and it&apos;ll be read automatically, split into
        individual issues, and filed for review — grouped by trade (electrical, plumbing, etc.) — instead of typing
        each one in by hand below.
      </p>
      <label className="btn-outline inline-block cursor-pointer text-sm">
        {uploading || isRunning(taskKey) ? (status ?? "Reading…") : "+ Upload report"}
        <input
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          disabled={uploading || isRunning(taskKey)}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
