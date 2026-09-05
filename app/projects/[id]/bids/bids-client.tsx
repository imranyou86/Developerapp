"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  deleteBid,
  saveBid,
  saveBidEvaluation,
  setBidStatus,
  type BidEvaluationInput,
  type SaveBidInput,
} from "@/app/projects/[id]/bids/actions";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { stripLeadingZero } from "@/lib/numberInput";

interface PaymentLine {
  id: string;
  label: string;
  amount: number;
}

type BidVerdict = "good_price" | "fair_price" | "high_price";
type BidConfidence = "high" | "medium" | "low";

interface BidRow {
  id: string;
  contractor: string;
  total_amount: number;
  file_name: string | null;
  file_url: string | null;
  uploaded_at: string;
  status: "pending" | "declined";
  evaluation_verdict: BidVerdict | null;
  evaluation_confidence: BidConfidence | null;
  evaluation_market_low: number | null;
  evaluation_market_high: number | null;
  evaluation_analysis: string | null;
  payment_schedule_items: PaymentLine[];
}

function currency(n: number): string {
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const VERDICT_LABEL: Record<BidVerdict, string> = {
  good_price: "Good price",
  fair_price: "Fair price",
  high_price: "High price",
};

const VERDICT_STYLE: Record<BidVerdict, string> = {
  good_price: "badge-sage",
  fair_price: "badge bg-blueprint/10 text-blueprint/60",
  high_price: "badge bg-red-100 text-red-700",
};

export function BidsClient({
  projectId,
  initialBids,
  projectAddress,
}: {
  projectId: string;
  initialBids: BidRow[];
  projectAddress: string | null;
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const extractTaskKey = `bid-extract:${projectId}`;
  const reviewStorageKey = `bid-review:${projectId}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bids, setBids] = useState<BidRow[]>(initialBids);
  const [extracting, setExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState("");
  const [deleting, setDeleting] = useState<BidRow | null>(null);

  const pendingBids = bids.filter((b) => b.status === "pending");
  const declinedBids = bids.filter((b) => b.status === "declined");

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

  async function handleStatusChange(bid: BidRow, status: "pending" | "accepted" | "declined") {
    const res = await setBidStatus(projectId, bid.id, status);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update this bid.");
      return;
    }
    if (status === "accepted") {
      // Accepted bids live on the Payments tab from here on, not here.
      setBids((prev) => prev.filter((b) => b.id !== bid.id));
      notify("success", `${bid.contractor} accepted — its payment schedule is now on the Payments tab.`);
    } else {
      setBids((prev) => prev.map((b) => (b.id === bid.id ? { ...b, status } : b)));
      notify("success", status === "declined" ? "Bid declined." : "Moved back to Incoming bids.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-blueprint-dark">Bids</h2>
            <p className="text-sm text-blueprint/60">
              Upload a contractor bid or proposal PDF — the contractor, total, and full draw schedule are
              extracted automatically for you to review. It lands below for you to compare against other bids and
              evaluate before accepting; only an accepted bid shows up on the Payments tab.
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

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-blueprint/50">
          Incoming bids {pendingBids.length > 0 && `(${pendingBids.length})`}
        </h3>
        {pendingBids.length === 0 ? (
          <div className="card p-10 text-center text-sm text-blueprint/60">
            No bids awaiting a decision. Upload one above, or check Payments for already-accepted bids.
          </div>
        ) : (
          <div className="space-y-4">
            {pendingBids.map((bid) => (
              <IncomingBidCard
                key={bid.id}
                projectId={projectId}
                bid={bid}
                projectAddress={projectAddress}
                onAccept={() => handleStatusChange(bid, "accepted")}
                onDecline={() => handleStatusChange(bid, "declined")}
                onDelete={() => setDeleting(bid)}
                onEvaluated={(evaluation) =>
                  setBids((prev) => prev.map((b) => (b.id === bid.id ? { ...b, ...evaluation } : b)))
                }
              />
            ))}
          </div>
        )}
      </div>

      {declinedBids.length > 0 && (
        <details className="card p-5">
          <summary className="cursor-pointer text-sm font-semibold text-blueprint-dark">
            Declined bids ({declinedBids.length})
          </summary>
          <div className="mt-3 space-y-2">
            {declinedBids.map((bid) => (
              <div key={bid.id} className="flex items-center gap-2 rounded-lg border border-blueprint/10 p-2 text-sm">
                <span className="flex-1 truncate">
                  {bid.contractor} <span className="text-blueprint/40">· {currency(bid.total_amount)}</span>
                </span>
                <button className="text-xs text-amber-dark hover:underline" onClick={() => handleStatusChange(bid, "pending")}>
                  Reconsider
                </button>
                <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(bid)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
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
                status: "pending",
                evaluation_verdict: null,
                evaluation_confidence: null,
                evaluation_market_low: null,
                evaluation_market_high: null,
                evaluation_analysis: null,
                payment_schedule_items: input.payment_schedule.map((l) => ({
                  id: crypto.randomUUID(),
                  label: l.label,
                  amount: l.amount,
                })),
              },
              ...prev,
            ]);
            notify("success", "Bid added to Incoming bids.");
            setReview(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete bid?"
        message={`Delete the bid from "${deleting?.contractor}"? This cannot be undone.`}
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

function IncomingBidCard({
  projectId,
  bid,
  projectAddress,
  onAccept,
  onDecline,
  onDelete,
  onEvaluated,
}: {
  projectId: string;
  bid: BidRow;
  projectAddress: string | null;
  onAccept: () => void;
  onDecline: () => void;
  onDelete: () => void;
  onEvaluated: (evaluation: {
    evaluation_verdict: BidVerdict;
    evaluation_confidence: BidConfidence;
    evaluation_market_low: number | null;
    evaluation_market_high: number | null;
    evaluation_analysis: string;
  }) => void;
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const evaluateTaskKey = `bid-evaluate:${bid.id}`;

  async function handleEvaluate() {
    try {
      await run(evaluateTaskKey, `Checking ${bid.contractor}'s price against the market…`, async () => {
        const res = await fetchWithRetry("/api/claude/evaluate-bid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractor: bid.contractor,
            total_amount: bid.total_amount,
            payment_schedule: bid.payment_schedule_items.map((l) => ({ label: l.label, amount: l.amount })),
            address: projectAddress,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Evaluation failed.");

        const evaluation: BidEvaluationInput = {
          verdict: json.verdict,
          confidence: json.confidence,
          market_range_low: json.market_range_low ?? null,
          market_range_high: json.market_range_high ?? null,
          analysis: json.analysis ?? "",
        };
        const saveRes = await saveBidEvaluation(projectId, bid.id, evaluation);
        if (!saveRes.ok) throw new Error(saveRes.error ?? "Could not save evaluation.");

        onEvaluated({
          evaluation_verdict: evaluation.verdict,
          evaluation_confidence: evaluation.confidence,
          evaluation_market_low: evaluation.market_range_low,
          evaluation_market_high: evaluation.market_range_high,
          evaluation_analysis: evaluation.analysis,
        });
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not evaluate this bid.");
    }
  }

  const evaluating = isRunning(evaluateTaskKey);

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-blueprint-dark">{bid.contractor}</h3>
          <p className="text-xs text-blueprint/50">
            {currency(bid.total_amount)} total
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
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn-primary text-xs" onClick={onAccept}>
            Accept
          </button>
          <button className="btn-outline text-xs" onClick={onDecline}>
            Decline
          </button>
          <button className="text-xs text-red-500 hover:underline" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      {bid.payment_schedule_items.length > 0 && (
        <div className="mb-3 space-y-1">
          {bid.payment_schedule_items.map((line) => (
            <div key={line.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm">
              <span className="flex-1 text-blueprint/70">{line.label}</span>
              <span className="font-medium text-blueprint-dark">{currency(line.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-blueprint/10 pt-3">
        {bid.evaluation_verdict ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={VERDICT_STYLE[bid.evaluation_verdict]}>{VERDICT_LABEL[bid.evaluation_verdict]}</span>
              <span className="text-xs text-blueprint/40">{bid.evaluation_confidence} confidence</span>
              {bid.evaluation_market_low != null && bid.evaluation_market_high != null && (
                <span className="text-xs text-blueprint/50">
                  Typical range: {currency(bid.evaluation_market_low)}–{currency(bid.evaluation_market_high)}
                </span>
              )}
              <button
                className="ml-auto text-xs text-amber-dark hover:underline"
                onClick={handleEvaluate}
                disabled={evaluating}
              >
                {evaluating ? "Re-evaluating…" : "Re-evaluate"}
              </button>
            </div>
            {bid.evaluation_analysis && <p className="text-xs text-blueprint/60">{bid.evaluation_analysis}</p>}
          </div>
        ) : (
          <button className="btn-outline text-xs" onClick={handleEvaluate} disabled={evaluating}>
            {evaluating ? "Evaluating…" : "Evaluate bid"}
          </button>
        )}
      </div>
    </div>
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
            {saving ? "Saving…" : "Add to Incoming bids"}
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
