"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { stripLeadingZero } from "@/lib/numberInput";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";
import {
  deleteTradeBidReview,
  saveTradeBidEvaluation,
  saveTradeBidReview,
  type SaveTradeBidReviewInput,
  type TradeBidEvaluationInput,
} from "@/app/construction-cost/trade-bid-actions";
import type { TradeBidReview, TradeBidVerdict } from "@/lib/types";

interface SubcontractorOption {
  id: string;
  company_name: string;
  trade: string | null;
}

function currency(n: number): string {
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const VERDICT_LABEL: Record<TradeBidVerdict, string> = {
  good_price: "Good price",
  fair_price: "Fair price",
  high_price: "High price",
};

const VERDICT_STYLE: Record<TradeBidVerdict, string> = {
  good_price: "badge-sage",
  fair_price: "badge bg-blueprint/10 text-blueprint/60",
  high_price: "badge bg-red-100 text-red-700",
};

// Construction Cost's "Trade Bid Review" — a lighter-weight sibling to the
// Bids tab: one subcontractor's bid for one trade, entered by hand (trade,
// sub, amount, a scope description) rather than extracted from a payment
// schedule PDF, since a trade bid's scope rarely arrives as a clean draw
// schedule the way a GC bid's does. "Evaluate" (app/api/claude/evaluate-trade-bid)
// checks the price against the market for that trade/region, flags likely
// gaps in the stated scope, and suggests specific questions to ask before
// signing.
export function TradeBidClient({
  projectId,
  projectAddress,
  initialReviews,
  subcontractors,
}: {
  projectId: string;
  projectAddress: string | null;
  initialReviews: TradeBidReview[];
  subcontractors: SubcontractorOption[];
}) {
  const { notify } = useToast();
  const [reviews, setReviews] = useState<TradeBidReview[]>(initialReviews);
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<TradeBidReview | null>(null);

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-blueprint-dark">Trade Bid Review</h2>
            <p className="text-sm text-blueprint/60">
              Log a subcontractor&apos;s bid for a specific trade — electrical, plumbing, framing, whatever it is —
              and get an AI read on whether the price is fair, whether the scope looks complete, and good questions
              to ask before signing.
            </p>
          </div>
          <button className="btn-amber shrink-0" onClick={() => setAddOpen(true)}>
            + Add a trade bid
          </button>
        </div>
      </div>

      {reviews.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">No trade bids logged yet.</div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review, i) => (
            <div key={review.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(i * 40, 300)}ms` }}>
              <TradeBidCard
                review={review}
                projectAddress={projectAddress}
                onDelete={() => setDeleting(review)}
                onEvaluated={(evaluation) =>
                  setReviews((prev) =>
                    prev.map((r) =>
                      r.id === review.id
                        ? {
                            ...r,
                            evaluation_verdict: evaluation.verdict,
                            evaluation_confidence: evaluation.confidence,
                            evaluation_market_low: evaluation.market_range_low,
                            evaluation_market_high: evaluation.market_range_high,
                            evaluation_analysis: evaluation.analysis,
                            evaluation_questions: evaluation.questions_to_ask,
                            evaluation_scope_complete: evaluation.scope_complete,
                            evaluation_missing_items: evaluation.missing_items,
                            evaluation_completeness_note: evaluation.completeness_note,
                          }
                        : r
                    )
                  )
                }
              />
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <AddTradeBidModal
          projectId={projectId}
          subcontractors={subcontractors}
          onClose={() => setAddOpen(false)}
          onSaved={(review) => {
            setReviews((prev) => [review, ...prev]);
            notify("success", "Trade bid added.");
            setAddOpen(false);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete this trade bid?"
        message={`Delete the bid from "${deleting?.subcontractor_name}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteTradeBidReview(deleting.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete this trade bid.");
          } else {
            setReviews((prev) => prev.filter((r) => r.id !== deleting.id));
            notify("success", "Trade bid deleted.");
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function TradeBidCard({
  review,
  projectAddress,
  onDelete,
  onEvaluated,
}: {
  review: TradeBidReview;
  projectAddress: string | null;
  onDelete: () => void;
  onEvaluated: (evaluation: TradeBidEvaluationInput) => void;
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const evaluateTaskKey = `trade-bid-evaluate:${review.id}`;
  const [expanded, setExpanded] = useState(false);

  async function handleEvaluate() {
    try {
      await run(evaluateTaskKey, `Checking ${review.subcontractor_name}'s ${review.trade} bid against the market…`, async () => {
        const res = await fetchWithRetry("/api/claude/evaluate-trade-bid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trade: review.trade,
            subcontractor_name: review.subcontractor_name,
            bid_amount: review.bid_amount,
            scope_notes: review.scope_notes,
            address: projectAddress,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Evaluation failed.");

        const evaluation: TradeBidEvaluationInput = {
          verdict: json.verdict,
          confidence: json.confidence,
          market_range_low: json.market_range_low ?? null,
          market_range_high: json.market_range_high ?? null,
          analysis: json.analysis ?? "",
          questions_to_ask: json.questions_to_ask ?? [],
          scope_complete: json.scope_complete ?? null,
          missing_items: json.missing_items ?? [],
          completeness_note: json.completeness_note ?? "",
        };
        const saveRes = await saveTradeBidEvaluation(review.id, evaluation);
        if (!saveRes.ok) throw new Error(saveRes.error ?? "Could not save evaluation.");

        onEvaluated(evaluation);
        setExpanded(true);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not evaluate this bid.");
    }
  }

  const evaluating = isRunning(evaluateTaskKey);
  const evaluated = !!review.evaluation_verdict;

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-blueprint-dark">
            {review.subcontractor_name} <span className="font-normal text-blueprint/50">— {review.trade}</span>
          </h3>
          <p className="text-xs text-blueprint/50">
            {currency(review.bid_amount)} bid
            {review.file_name && (
              <>
                {" · "}
                {review.file_url ? (
                  <a href={review.file_url} target="_blank" rel="noreferrer" className="text-amber-dark hover:underline">
                    {review.file_name}
                  </a>
                ) : (
                  review.file_name
                )}
              </>
            )}
          </p>
        </div>
        <button className="shrink-0 text-xs text-red-500 hover:underline" onClick={onDelete}>
          Delete
        </button>
      </div>

      {review.scope_notes && <p className="mb-3 whitespace-pre-wrap text-sm text-blueprint/70">{review.scope_notes}</p>}

      <div className="border-t border-blueprint/10 pt-3">
        {evaluated ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={VERDICT_STYLE[review.evaluation_verdict as TradeBidVerdict]}>
                {VERDICT_LABEL[review.evaluation_verdict as TradeBidVerdict]}
              </span>
              <span className="text-xs text-blueprint/40">{review.evaluation_confidence} confidence</span>
              {review.evaluation_market_low != null && review.evaluation_market_high != null && (
                <span className="text-xs text-blueprint/50">
                  Typical range: {currency(review.evaluation_market_low)}–{currency(review.evaluation_market_high)}
                </span>
              )}
              <button
                className="ml-auto text-xs text-amber-dark hover:underline"
                onClick={() => setExpanded((e) => !e)}
              >
                {expanded ? "Hide details" : "Show details"}
              </button>
              <button className="text-xs text-amber-dark hover:underline" onClick={handleEvaluate} disabled={evaluating}>
                {evaluating ? "Re-evaluating…" : "Re-evaluate"}
              </button>
            </div>

            {expanded && (
              <div className="space-y-3 rounded-lg bg-concrete/60 p-3">
                {review.evaluation_analysis && <p className="text-xs text-blueprint/70">{review.evaluation_analysis}</p>}

                {review.evaluation_questions.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-blueprint/50">Questions to ask</p>
                    <ul className="list-disc space-y-1 pl-4 text-xs text-blueprint/70">
                      {review.evaluation_questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-blueprint/50">Scope completeness</p>
                  <p className="text-xs text-blueprint/70">
                    {review.evaluation_scope_complete === true && "✅ Looks like a complete scope for this trade."}
                    {review.evaluation_scope_complete === false && "⚠️ May be missing some standard scope items."}
                    {review.evaluation_scope_complete === null && "❓ Not enough information to judge completeness."}
                    {review.evaluation_completeness_note && ` ${review.evaluation_completeness_note}`}
                  </p>
                  {review.evaluation_missing_items.length > 0 && (
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-blueprint/70">
                      {review.evaluation_missing_items.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
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

function AddTradeBidModal({
  projectId,
  subcontractors,
  onClose,
  onSaved,
}: {
  projectId: string;
  subcontractors: SubcontractorOption[];
  onClose: () => void;
  onSaved: (review: TradeBidReview) => void;
}) {
  const { notify } = useToast();
  const [trade, setTrade] = useState("");
  const [subcontractorId, setSubcontractorId] = useState("");
  const [subcontractorName, setSubcontractorName] = useState("");
  const [bidAmount, setBidAmount] = useState("");
  const [scopeNotes, setScopeNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  function handlePickSubcontractor(id: string) {
    setSubcontractorId(id);
    const sub = subcontractors.find((s) => s.id === id);
    if (sub) {
      setSubcontractorName(sub.company_name);
      if (!trade && sub.trade) setTrade(sub.trade);
    }
  }

  async function handleSave() {
    if (!trade.trim() || !subcontractorName.trim() || !bidAmount) return;
    setSaving(true);
    try {
      let fileName: string | null = null;
      let fileUrl: string | null = null;
      if (file) {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in.");

        const path = `${user.id}/${projectId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("bid-files").upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
        if (uploadError) throw new Error(uploadError.message);
        const { data: pub, error: signError } = await supabase.storage.from("bid-files").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (signError || !pub) throw new Error(signError?.message ?? "Could not get a URL for the uploaded file.");
        fileName = file.name;
        fileUrl = pub.signedUrl;
      }

      const input: SaveTradeBidReviewInput = {
        trade: trade.trim(),
        subcontractor_name: subcontractorName.trim(),
        subcontractor_id: subcontractorId || null,
        bid_amount: Number(bidAmount) || 0,
        scope_notes: scopeNotes.trim() || null,
        file_name: fileName,
        file_url: fileUrl,
      };
      const res = await saveTradeBidReview(projectId, input);
      if (!res.ok || !res.id) throw new Error(res.error ?? "Could not save trade bid.");

      onSaved({
        id: res.id,
        project_id: projectId,
        trade: input.trade,
        subcontractor_name: input.subcontractor_name,
        subcontractor_id: input.subcontractor_id,
        bid_amount: input.bid_amount,
        scope_notes: input.scope_notes,
        file_name: input.file_name,
        file_url: input.file_url,
        evaluation_verdict: null,
        evaluation_confidence: null,
        evaluation_market_low: null,
        evaluation_market_high: null,
        evaluation_analysis: null,
        evaluation_questions: [],
        evaluation_scope_complete: null,
        evaluation_missing_items: [],
        evaluation_completeness_note: null,
        evaluated_at: null,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not save trade bid.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a trade bid"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={saving || !trade.trim() || !subcontractorName.trim() || !bidAmount}
            onClick={handleSave}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Trade</label>
          <input
            className="input"
            placeholder="e.g. &quot;Electrical&quot;"
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            autoFocus
          />
        </div>

        {subcontractors.length > 0 && (
          <div>
            <label className="label">Link a subcontractor from your directory (optional)</label>
            <select className="input" value={subcontractorId} onChange={(e) => handlePickSubcontractor(e.target.value)}>
              <option value="">None — enter name manually</option>
              {subcontractors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company_name}
                  {s.trade ? ` — ${s.trade}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="label">Subcontractor name</label>
          <input
            className="input"
            placeholder="e.g. &quot;Acme Electric&quot;"
            value={subcontractorName}
            onChange={(e) => {
              setSubcontractorId("");
              setSubcontractorName(e.target.value);
            }}
          />
        </div>

        <div>
          <label className="label">Bid amount</label>
          <input
            className="input"
            type="number"
            min="0"
            placeholder="0"
            value={bidAmount}
            onChange={(e) => setBidAmount(stripLeadingZero(e.target.value))}
          />
        </div>

        <div>
          <label className="label">Scope notes (optional)</label>
          <textarea
            className="input"
            rows={4}
            placeholder="What does this bid say is included? Paste it in or describe it — the more detail, the better the completeness check."
            value={scopeNotes}
            onChange={(e) => setScopeNotes(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Attach the bid document (optional)</label>
          <input
            type="file"
            accept="application/pdf,image/*,.doc,.docx"
            className="input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>
    </Modal>
  );
}
