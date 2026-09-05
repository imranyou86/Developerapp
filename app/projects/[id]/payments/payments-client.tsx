"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  addPaymentLine,
  deleteBid,
  deletePaymentLine,
  markPaymentPaid,
  saveBid,
  updatePaymentLine,
  type SaveBidInput,
} from "@/app/projects/[id]/payments/actions";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { stripLeadingZero } from "@/lib/numberInput";

interface PaymentLine {
  id: string;
  label: string;
  amount: number;
  paid: boolean;
}

interface BidRow {
  id: string;
  contractor: string;
  total_amount: number;
  file_name: string | null;
  file_url: string | null;
  uploaded_at: string;
  payment_schedule_items: PaymentLine[];
}

function currency(n: number): string {
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function PaymentsClient({ projectId, initialBids }: { projectId: string; initialBids: BidRow[] }) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const extractTaskKey = `bid-extract:${projectId}`;
  const reviewStorageKey = `bid-review:${projectId}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bids, setBids] = useState<BidRow[]>(initialBids);
  const [extracting, setExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState("");
  const [deleting, setDeleting] = useState<BidRow | null>(null);

  type ReviewDraft = {
    contractor: string;
    total_amount: number;
    file_name: string | null;
    file_url: string | null;
    payment_schedule: { label: string; amount: number }[];
  };

  const [review, setReviewState] = useState<ReviewDraft | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(reviewStorageKey);
      return raw ? (JSON.parse(raw) as ReviewDraft) : null;
    } catch {
      return null;
    }
  });

  function setReview(next: ReviewDraft | null) {
    setReviewState(next);
    try {
      if (next) sessionStorage.setItem(reviewStorageKey, JSON.stringify(next));
      else sessionStorage.removeItem(reviewStorageKey);
    } catch {
      // ignore — storage unavailable
    }
  }

  const projectPaid = bids.reduce(
    (sum, b) => sum + b.payment_schedule_items.filter((l) => l.paid).reduce((s, l) => s + Number(l.amount), 0),
    0
  );
  const projectTotal = bids.reduce((sum, b) => sum + Number(b.total_amount), 0);

  async function handleFile(file: File) {
    setExtracting(true);
    setExtractStatus("Reading PDF…");
    try {
      await run(extractTaskKey, `Extracting bid details from "${file.name}"…`, async () => {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in.");

        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

        // Extract the full text of every page — payment schedules often sit on
        // later pages of long documents, so nothing here is truncated.
        let fullText = "";
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((it) => ("str" in it ? it.str : "")).join(" ");
          fullText += `\n\n--- Page ${pageNum} ---\n${pageText}`;
        }

        // Upload the original PDF for reference regardless of extraction path.
        setExtractStatus("Uploading document…");
        const path = `${user.id}/${projectId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("bid-files").upload(path, file, {
          contentType: "application/pdf",
        });
        if (uploadError) throw new Error(uploadError.message);
        const { data: pub } = supabase.storage.from("bid-files").getPublicUrl(path);

        let requestBody: { text?: string; pageImageUrls?: string[] };

        if (fullText.trim().length > 200) {
          requestBody = { text: fullText };
        } else {
          // Likely a scanned/image-only document — fall back to page images.
          setExtractStatus("Document looks scanned — rendering pages for image-based reading…");
          const pageImageUrls: string[] = [];
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Canvas rendering is not supported in this browser.");
            await page.render({ canvasContext: context, viewport }).promise;
            const blob: Blob = await new Promise((resolve, reject) =>
              canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode page image."))), "image/png")
            );
            const imgPath = `${user.id}/${projectId}/${Date.now()}-p${pageNum}-${file.name}.png`;
            const { error: imgUploadError } = await supabase.storage.from("bid-files").upload(imgPath, blob, {
              contentType: "image/png",
            });
            if (imgUploadError) throw new Error(imgUploadError.message);
            const { data: imgPub } = supabase.storage.from("bid-files").getPublicUrl(imgPath);
            pageImageUrls.push(imgPub.publicUrl);
          }
          requestBody = { pageImageUrls };
        }

        setExtractStatus("Extracting contractor, total & payment schedule…");
        const res = await fetchWithRetry("/api/claude/extract-bid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Extraction failed.");

        setReview({
          contractor: json.contractor ?? "",
          total_amount: Number(json.total_amount) || 0,
          file_name: file.name,
          file_url: pub.publicUrl,
          payment_schedule: (json.payment_schedule ?? []).map((l: { label: string; amount: number }) => ({
            label: l.label,
            amount: Number(l.amount) || 0,
          })),
        });
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not process bid document.");
    } finally {
      setExtracting(false);
      setExtractStatus("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Contracts total" value={currency(projectTotal)} />
        <SummaryCard label="Paid to date" value={currency(projectPaid)} tone="sage" />
        <SummaryCard label="Remaining" value={currency(projectTotal - projectPaid)} />
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-blueprint-dark">Bids &amp; payment schedules</h2>
            <p className="text-sm text-blueprint/60">
              Upload a contractor bid or proposal PDF — the contractor, total, and full draw schedule are
              extracted automatically for you to review before saving.
            </p>
          </div>
          <button
            className="btn-amber"
            onClick={() => fileInputRef.current?.click()}
            disabled={extracting || isRunning(extractTaskKey)}
          >
            {extracting || isRunning(extractTaskKey) ? extractStatus || "Processing…" : "Upload bid"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      </div>

      {bids.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">No bids uploaded yet.</div>
      ) : (
        <div className="space-y-4">
          {bids.map((bid) => (
            <BidCard
              key={bid.id}
              projectId={projectId}
              bid={bid}
              onDelete={() => setDeleting(bid)}
              onPaidChanged={(lineId, paid) =>
                setBids((prev) =>
                  prev.map((b) =>
                    b.id === bid.id
                      ? { ...b, payment_schedule_items: b.payment_schedule_items.map((l) => (l.id === lineId ? { ...l, paid } : l)) }
                      : b
                  )
                )
              }
              onBidUpdated={(updated) => setBids((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))}
            />
          ))}
        </div>
      )}

      {review && (
        <ReviewBidModal
          review={review}
          onClose={() => setReview(null)}
          onSave={async (input) => {
            const res = await saveBid(projectId, input);
            if (!res.ok || !res.id) {
              notify("error", res.error ?? "Could not save bid.");
              return;
            }
            setBids((prev) => [
              {
                id: res.id!,
                contractor: input.contractor,
                total_amount: input.total_amount,
                file_name: input.file_name,
                file_url: input.file_url,
                uploaded_at: new Date().toISOString(),
                payment_schedule_items: input.payment_schedule.map((l) => ({
                  id: crypto.randomUUID(),
                  label: l.label,
                  amount: l.amount,
                  paid: false,
                })),
              },
              ...prev,
            ]);
            notify("success", "Bid saved.");
            setReview(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete bid?"
        message={`Delete the bid from "${deleting?.contractor}" and its payment schedule? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteBid(projectId, deleting.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete bid.");
          } else {
            setBids((prev) => prev.filter((b) => b.id !== deleting.id));
            notify("success", "Bid deleted.");
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "sage" }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-blueprint/50">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === "sage" ? "text-sage-dark" : "text-blueprint-dark"}`}>{value}</p>
    </div>
  );
}

function BidCard({
  projectId,
  bid,
  onDelete,
  onPaidChanged,
  onBidUpdated,
}: {
  projectId: string;
  bid: BidRow;
  onDelete: () => void;
  onPaidChanged: (lineId: string, paid: boolean) => void;
  onBidUpdated: (bid: BidRow) => void;
}) {
  const { notify } = useToast();
  const paid = bid.payment_schedule_items.filter((l) => l.paid).reduce((s, l) => s + Number(l.amount), 0);
  const [addingLine, setAddingLine] = useState(false);
  const [editingLine, setEditingLine] = useState<PaymentLine | null>(null);
  const [deletingLine, setDeletingLine] = useState<PaymentLine | null>(null);
  const [deletingLineBusy, setDeletingLineBusy] = useState(false);

  async function handleToggle(lineId: string, next: boolean) {
    onPaidChanged(lineId, next);
    const res = await markPaymentPaid(projectId, lineId, next);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update payment status.");
      onPaidChanged(lineId, !next);
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-blueprint-dark">{bid.contractor}</h3>
          <p className="text-xs text-blueprint/50">
            {currency(paid)} paid of {currency(bid.total_amount)}
            {bid.file_name && (
              <>
                {" · "}
                {bid.file_url ? (
                  <a href={bid.file_url} target="_blank" rel="noreferrer" className="text-amber-dark hover:underline">
                    {bid.file_name}
                  </a>
                ) : (
                  bid.file_name
                )}
              </>
            )}
          </p>
        </div>
        <button className="text-xs text-red-500 hover:underline" onClick={onDelete}>
          Delete bid
        </button>
      </div>

      <div className="space-y-1">
        {bid.payment_schedule_items.map((line) => (
          <div key={line.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-concrete">
            <input type="checkbox" checked={line.paid} onChange={(e) => handleToggle(line.id, e.target.checked)} />
            <span className={`flex-1 text-sm ${line.paid ? "text-blueprint/40 line-through" : ""}`}>{line.label}</span>
            <span className="text-sm font-medium">{currency(line.amount)}</span>
            <button
              className="text-xs text-blueprint/50 opacity-0 hover:underline group-hover:opacity-100"
              onClick={() => setEditingLine(line)}
            >
              Edit
            </button>
            <button
              className="text-xs text-red-500 opacity-0 hover:underline group-hover:opacity-100"
              onClick={() => setDeletingLine(line)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button className="btn-ghost mt-2 text-xs" onClick={() => setAddingLine(true)}>
        + Add item
      </button>
      <p className="mt-1 text-xs text-blueprint/40">
        For overages/change orders — adding or editing an item here adjusts this bid&apos;s total above by the same
        amount.
      </p>

      {addingLine && (
        <PaymentLineModal
          title="Add payment schedule item"
          saveLabel="Add item"
          onClose={() => setAddingLine(false)}
          onSave={async (input) => {
            const res = await addPaymentLine(projectId, bid.id, input);
            if (!res.ok || !res.id) {
              notify("error", res.error ?? "Could not add item.");
              return;
            }
            onBidUpdated({
              ...bid,
              total_amount: res.newTotal ?? bid.total_amount,
              payment_schedule_items: [...bid.payment_schedule_items, { id: res.id, label: input.label, amount: input.amount, paid: false }],
            });
            notify("success", "Item added.");
            setAddingLine(false);
          }}
        />
      )}

      {editingLine && (
        <PaymentLineModal
          title="Edit payment schedule item"
          saveLabel="Save changes"
          initialLabel={editingLine.label}
          initialAmount={editingLine.amount}
          onClose={() => setEditingLine(null)}
          onSave={async (input) => {
            const res = await updatePaymentLine(projectId, bid.id, editingLine.id, input);
            if (!res.ok) {
              notify("error", res.error ?? "Could not save changes.");
              return;
            }
            onBidUpdated({
              ...bid,
              total_amount: res.newTotal ?? bid.total_amount,
              payment_schedule_items: bid.payment_schedule_items.map((l) =>
                l.id === editingLine.id ? { ...l, label: input.label, amount: input.amount } : l
              ),
            });
            notify("success", "Item updated.");
            setEditingLine(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deletingLine}
        title="Remove item?"
        message={`Remove "${deletingLine?.label}" (${deletingLine ? currency(deletingLine.amount) : ""}) from this bid's payment schedule? The bid total will be reduced by the same amount.`}
        confirmLabel="Remove"
        danger
        busy={deletingLineBusy}
        onCancel={() => setDeletingLine(null)}
        onConfirm={async () => {
          if (!deletingLine) return;
          setDeletingLineBusy(true);
          const res = await deletePaymentLine(projectId, bid.id, deletingLine.id);
          setDeletingLineBusy(false);
          if (!res.ok) {
            notify("error", res.error ?? "Could not remove item.");
          } else {
            onBidUpdated({
              ...bid,
              total_amount: res.newTotal ?? bid.total_amount,
              payment_schedule_items: bid.payment_schedule_items.filter((l) => l.id !== deletingLine.id),
            });
            notify("success", "Item removed.");
          }
          setDeletingLine(null);
        }}
      />
    </div>
  );
}

function PaymentLineModal({
  title,
  saveLabel,
  initialLabel = "",
  initialAmount = 0,
  onClose,
  onSave,
}: {
  title: string;
  saveLabel: string;
  initialLabel?: string;
  initialAmount?: number;
  onClose: () => void;
  onSave: (input: { label: string; amount: number }) => Promise<void>;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [amount, setAmount] = useState(initialAmount.toString());
  const [saving, setSaving] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={saving || !label.trim()}
            onClick={async () => {
              setSaving(true);
              await onSave({ label: label.trim(), amount: Number(amount) || 0 });
              setSaving(false);
            }}
          >
            {saving ? "Saving…" : saveLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Description</label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Overage — additional excavation"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Amount</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(stripLeadingZero(e.target.value))}
            onFocus={(e) => e.target.select()}
          />
        </div>
      </div>
    </Modal>
  );
}

function ReviewBidModal({
  review,
  onClose,
  onSave,
}: {
  review: {
    contractor: string;
    total_amount: number;
    file_name: string | null;
    file_url: string | null;
    payment_schedule: { label: string; amount: number }[];
  };
  onClose: () => void;
  onSave: (input: SaveBidInput) => void;
}) {
  const [contractor, setContractor] = useState(review.contractor);
  const [totalAmount, setTotalAmount] = useState(review.total_amount.toString());
  const [lines, setLines] = useState(review.payment_schedule);
  const [saving, setSaving] = useState(false);

  function updateLine(i: number, patch: Partial<{ label: string; amount: number }>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const linesTotal = lines.reduce((s, l) => s + Number(l.amount || 0), 0);

  return (
    <Modal
      open
      onClose={onClose}
      title="Review extracted bid"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={saving || !contractor.trim()}
            onClick={async () => {
              setSaving(true);
              await onSave({
                contractor,
                total_amount: Number(totalAmount) || 0,
                file_name: review.file_name,
                file_url: review.file_url,
                payment_schedule: lines.filter((l) => l.label.trim()),
              });
              setSaving(false);
            }}
          >
            {saving ? "Saving…" : "Save bid"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Contractor</label>
            <input className="input" value={contractor} onChange={(e) => setContractor(e.target.value)} />
          </div>
          <div>
            <label className="label">Total contract amount</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={totalAmount}
              onChange={(e) => setTotalAmount(stripLeadingZero(e.target.value))}
              onFocus={(e) => e.target.select()}
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Payment schedule</label>
            <span className="text-xs text-blueprint/50">
              Lines total: {currency(linesTotal)}
              {Math.abs(linesTotal - Number(totalAmount)) > 1 && (
                <span className="ml-1 text-amber-dark">(doesn&apos;t match contract total — check the document)</span>
              )}
            </span>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {lines.map((line, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  value={line.label}
                  onChange={(e) => updateLine(i, { label: e.target.value })}
                  placeholder="Draw description"
                />
                <input
                  className="input w-32"
                  type="number"
                  step="0.01"
                  value={line.amount}
                  onChange={(e) => updateLine(i, { amount: Number(e.target.value) })}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  className="text-xs text-red-500 hover:underline"
                  onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            className="btn-ghost mt-2 text-xs"
            onClick={() => setLines((prev) => [...prev, { label: "", amount: 0 }])}
          >
            + Add line
          </button>
        </div>
      </div>
    </Modal>
  );
}
