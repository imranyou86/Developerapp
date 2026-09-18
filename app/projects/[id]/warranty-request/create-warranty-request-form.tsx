"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { requestWarrantyItems, addInspectionReport } from "@/app/projects/[id]/warranty-request/actions";
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
  const [tasks, setTasks] = useState<string[]>([""]);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const usableTaskCount = tasks.filter((t) => t.trim()).length;
  // A shared description and attachments only make sense pinned to one
  // specific issue — once this is a batch of tasks under one trade (see
  // requestWarrantyItems: 2+ tasks sharing a category become one grouped
  // request), there's no single task to attach them to.
  const isBulk = tasks.length > 1;

  function updateTask(i: number, value: string) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? value : t)));
  }
  function addTaskRow() {
    setTasks((prev) => [...prev, ""]);
  }
  function removeTaskRow(i: number) {
    setTasks((prev) => prev.filter((_, idx) => idx !== i));
  }

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

  function reset() {
    setTasks([""]);
    setCategory("");
    setDescription("");
    setFiles([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const titles = tasks.map((t) => t.trim()).filter(Boolean);
    if (titles.length === 0) return;
    setSubmitting(true);
    setJustSubmitted(false);
    try {
      const res = await requestWarrantyItems(
        projectId,
        titles.map((title) => ({ title, comment: isBulk ? null : description, category: category || null }))
      );
      if (!res.ok || !res.ids) throw new Error(res.error ?? "Could not submit request.");

      // Attachments only apply to the single-task case — a grouped batch's
      // first id is the group itself, not one specific task, and there's no
      // one task to pin a file to anyway.
      if (!isBulk && files.length > 0) {
        const failedUploads: string[] = [];
        for (const file of files) {
          try {
            await uploadAttachment(res.ids[0], file);
          } catch {
            failedUploads.push(file.name);
          }
        }
        if (failedUploads.length > 0) {
          notify("error", `Request submitted, but couldn't attach: ${failedUploads.join(", ")}`);
        } else {
          notify("success", "Request submitted.");
        }
      } else {
        notify("success", titles.length === 1 ? "Request submitted." : `${titles.length} tasks submitted.`);
      }
      reset();
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
          it. Have several issues under the same trade (e.g. a few electrical things)? Add them all as separate tasks
          below — they&apos;ll be tracked as one request for that trade, with each task still reviewed on its own. Your
          Contractor, Developer, or PM will review it from here.
        </p>

        {justSubmitted && (
          <div className="mb-4 rounded-lg border border-sage/30 bg-sage/5 px-3 py-2 text-sm text-sage-dark">
            Request submitted — thank you. Feel free to file another below.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">{isBulk ? "Tasks" : "What's the issue?"}</label>
            <div className="space-y-2">
              {tasks.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="e.g. &quot;Leaky faucet in kitchen&quot;"
                    value={t}
                    onChange={(e) => updateTask(i, e.target.value)}
                    required={i === 0}
                  />
                  {tasks.length > 1 && (
                    <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => removeTaskRow(i)}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost mt-2 text-xs" onClick={addTaskRow}>
              + Add another task
            </button>
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

          {!isBulk && (
            <>
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
            </>
          )}

          <button type="submit" className="btn-amber w-full" disabled={submitting || usableTaskCount === 0}>
            {submitting ? "Submitting…" : usableTaskCount > 1 ? `Submit ${usableTaskCount} tasks` : "Submit request"}
          </button>
        </form>
      </div>
    </div>
  );
}
