"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { requestWarrantyItem, addInspectionReport } from "@/app/projects/[id]/warranty-request/actions";
import { WARRANTY_REQUEST_CATEGORIES } from "@/lib/warrantyRequestCategories";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";

// The entire "Warranty Request" tab experience for the 'warranty' role — a
// one-way submission form, not the Contractor/Developer/PM tracking
// dashboard (WarrantyRequestClient). It deliberately fetches and shows
// nothing back: no request list, no status, no comments, no subcontractor
// — the 'warranty' role files a request here and the rest is handled
// internally, the same way a CRM's public lead-capture form feeds a
// pipeline the submitter never sees into. page.tsx renders only this
// component for that role, skipping every other query entirely — so
// there's nothing to leak even by inspecting the page's own server
// response, not just the rendered UI.
export function CreateWarrantyRequestForm({ projectId }: { projectId: string }) {
  const { notify } = useToast();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  function addFiles(newFiles: File[]) {
    if (newFiles.length === 0) return;
    setFiles((prev) => [...prev, ...newFiles]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadAttachment(requestId: string, file: File) {
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

    const res = await addInspectionReport(projectId, file.name, pub.signedUrl, requestId);
    if (!res.ok) throw new Error(res.error ?? `Could not attach "${file.name}".`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setJustSubmitted(false);
    try {
      const res = await requestWarrantyItem(projectId, title, description, category || null);
      if (!res.ok || !res.id) throw new Error(res.error ?? "Could not submit request.");

      const failedUploads: string[] = [];
      for (const file of files) {
        try {
          await uploadAttachment(res.id, file);
        } catch {
          failedUploads.push(file.name);
        }
      }

      if (failedUploads.length > 0) {
        notify("error", `Request submitted, but couldn't attach: ${failedUploads.join(", ")}`);
      } else {
        notify("success", "Request submitted.");
      }
      setTitle("");
      setCategory("");
      setDescription("");
      setFiles([]);
      setJustSubmitted(true);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not submit request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-5">
        <h2 className="mb-1 font-semibold text-blueprint-dark">Create a Warranty Request</h2>
        <p className="mb-4 text-sm text-blueprint/60">
          Describe the issue, pick the category it falls under, and attach any photos or documents that help explain
          it. Your Contractor, Developer, or PM will review it from here.
        </p>

        {justSubmitted && (
          <div className="mb-4 rounded-lg border border-sage/30 bg-sage/5 px-3 py-2 text-sm text-sage-dark">
            Request submitted — thank you. Feel free to file another below.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">What&apos;s the issue?</label>
            <input
              className="input"
              placeholder="e.g. &quot;Leaky faucet in kitchen&quot;"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label">Category</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Choose a category…</option>
              {WARRANTY_REQUEST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Description (optional)</label>
            <textarea
              className="input"
              rows={4}
              placeholder="Any additional details — when it started, where exactly, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Photos or files (optional)</label>
            <input
              type="file"
              multiple
              accept="application/pdf,image/*,.doc,.docx"
              className="input"
              onChange={(e) => {
                // Snapshot into a plain array synchronously, in this same
                // tick — e.target.files is a *live* FileList, and the
                // React state update below runs the updater function after
                // this handler returns, by which point the value reset on
                // the next line has already emptied that same live list in
                // WebKit. A plain File[] array is immune to that.
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((file, i) => (
                  <div key={`${file.name}-${i}`} className="flex items-center justify-between rounded bg-concrete px-2 py-1 text-xs">
                    <span className="truncate text-blueprint-dark">{file.name}</span>
                    <button type="button" className="text-red-500 hover:underline" onClick={() => removeFile(i)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="submit" className="btn-amber w-full" disabled={submitting || !title.trim()}>
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </form>
      </div>
    </div>
  );
}
