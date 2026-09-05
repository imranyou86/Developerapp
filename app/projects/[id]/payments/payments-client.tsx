"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteBid } from "@/app/projects/[id]/bids/actions";
import { addPaymentLine, deletePaymentLine, markPaymentPaid, updatePaymentLine } from "@/app/projects/[id]/payments/actions";
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
  const [bids, setBids] = useState<BidRow[]>(initialBids);
  const [deleting, setDeleting] = useState<BidRow | null>(null);

  const projectPaid = bids.reduce(
    (sum, b) => sum + b.payment_schedule_items.filter((l) => l.paid).reduce((s, l) => s + Number(l.amount), 0),
    0
  );
  const projectTotal = bids.reduce((sum, b) => sum + Number(b.total_amount), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Contracts total" value={currency(projectTotal)} />
        <SummaryCard label="Paid to date" value={currency(projectPaid)} tone="sage" />
        <SummaryCard label="Remaining" value={currency(projectTotal - projectPaid)} />
      </div>

      <div className="card p-6">
        <h2 className="font-semibold text-blueprint-dark">Accepted bids &amp; payment schedules</h2>
        <p className="text-sm text-blueprint/60">
          Only bids you&apos;ve accepted show up here for payment tracking. Upload and review new bids — and accept
          the one you want — on the Bids tab.
        </p>
      </div>

      {bids.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">
          No accepted bids yet — go to the Bids tab to upload and accept one.
        </div>
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
