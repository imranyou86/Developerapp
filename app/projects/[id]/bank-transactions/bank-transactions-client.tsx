"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { parseBankCsv, type ParsedBankTransaction } from "@/lib/bankCsv";
import {
  assignTransactionBid,
  autoMatchTransactions,
  deleteBankTransaction,
  deleteBankTransactionsBySource,
  importBankTransactions,
} from "@/app/projects/[id]/bank-transactions/actions";
import type { BankTransaction } from "@/lib/types";

interface BidOption {
  id: string;
  contractor: string;
  total_amount: number;
  status: "pending" | "accepted";
}

function currency(n: number): string {
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(iso: string): string {
  // txn_date is a plain date (no time/zone) — parse as UTC-noon so it can't
  // roll back a day in a negative-UTC-offset browser timezone.
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

interface Totals {
  count: number;
  debit: number;
  credit: number;
  net: number;
}

function totalsOf(rows: BankTransaction[]): Totals {
  const debit = rows.filter((r) => r.type === "debit").reduce((s, r) => s + Number(r.amount), 0);
  const credit = rows.filter((r) => r.type === "credit").reduce((s, r) => s + Number(r.amount), 0);
  return { count: rows.length, debit, credit, net: credit - debit };
}

type BidFilter = "all" | "unmatched" | string;

export function BankTransactionsClient({
  projectId,
  initialTransactions,
  bids,
}: {
  projectId: string;
  initialTransactions: BankTransaction[];
  bids: BidOption[];
}) {
  const { notify } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [transactions, setTransactions] = useState<BankTransaction[]>(initialTransactions);
  const [preview, setPreview] = useState<{ fileName: string; rows: ParsedBankTransaction[]; skippedRows: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);
  const [deleting, setDeleting] = useState<BankTransaction | null>(null);
  const [undoingSource, setUndoingSource] = useState<string | null>(null);

  const [filterText, setFilterText] = useState("");
  const [filterType, setFilterType] = useState<"all" | "debit" | "credit">("all");
  const [filterBid, setFilterBid] = useState<BidFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const hasActiveFilter = filterText.trim() !== "" || filterType !== "all" || filterBid !== "all";

  const filteredTransactions = transactions.filter((t) => {
    if (filterType !== "all" && t.type !== filterType) return false;
    if (filterBid === "unmatched" && t.bid_id) return false;
    if (filterBid !== "all" && filterBid !== "unmatched" && t.bid_id !== filterBid) return false;
    if (filterText.trim() && !t.description.toLowerCase().includes(filterText.trim().toLowerCase())) return false;
    return true;
  });

  const visibleIds = filteredTransactions.map((t) => t.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const selectedTransactions = transactions.filter((t) => selectedIds.has(t.id));

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function handleFileChange(file: File | null) {
    setPreview(null);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const result = parseBankCsv(text);
      if (result.warning) {
        notify("error", result.warning);
        return;
      }
      if (result.transactions.length === 0) {
        notify("error", "No transactions found in that file.");
        return;
      }
      setPreview({ fileName: file.name, rows: result.transactions, skippedRows: result.skippedRows });
    };
    reader.onerror = () => notify("error", "Could not read that file.");
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const res = await importBankTransactions(projectId, preview.rows, preview.fileName);
      if (!res.ok) {
        notify("error", res.error ?? "Import failed.");
        return;
      }
      setTransactions((prev) => [...(res.insertedRows ?? []), ...prev]);
      const skippedNote = preview.skippedRows > 0 ? ` (${preview.skippedRows} row${preview.skippedRows === 1 ? "" : "s"} skipped — unrecognized)` : "";
      const dupeNote = res.duplicates ? `, ${res.duplicates} already on file` : "";
      notify("success", `Imported ${res.insertedRows?.length ?? 0} transaction${res.insertedRows?.length === 1 ? "" : "s"}${dupeNote}.${skippedNote}`);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setImporting(false);
    }
  }

  async function handleAssignBid(txn: BankTransaction, bidId: string | null) {
    const prev = txn.bid_id;
    setTransactions((rows) => rows.map((r) => (r.id === txn.id ? { ...r, bid_id: bidId } : r)));
    const res = await assignTransactionBid(projectId, txn.id, bidId);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update.");
      setTransactions((rows) => rows.map((r) => (r.id === txn.id ? { ...r, bid_id: prev } : r)));
    }
  }

  async function handleAutoMatch() {
    setAutoMatching(true);
    try {
      const res = await autoMatchTransactions(projectId);
      if (!res.ok) {
        notify("error", res.error ?? "Auto-match failed.");
        return;
      }
      const matches = res.matches ?? [];
      if (matches.length === 0) {
        notify("success", "No new matches found.");
        return;
      }
      const byId = new Map(matches.map((m) => [m.id, m.bidId]));
      setTransactions((rows) => rows.map((r) => (byId.has(r.id) ? { ...r, bid_id: byId.get(r.id)! } : r)));
      notify("success", `Matched ${matches.length} transaction${matches.length === 1 ? "" : "s"} to a bid by contractor name.`);
    } finally {
      setAutoMatching(false);
    }
  }

  const debitTransactions = transactions.filter((t) => t.type === "debit");
  const totalPaid = debitTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
  const unmatchedPaid = debitTransactions.filter((t) => !t.bid_id).reduce((sum, t) => sum + Number(t.amount), 0);
  const importSources = Array.from(new Set(transactions.map((t) => t.source_file_name).filter((n): n is string => !!n)));

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <h2 className="mb-1 text-sm font-semibold text-blueprint-dark">Import bank transactions</h2>
        <p className="mb-4 text-xs text-blueprint/50">
          Upload a CSV exported from your bank — most common formats are recognized automatically (a single signed
          Amount column, separate Debit/Credit columns, or a headerless Wells Fargo-style export). Re-importing an
          overlapping date range skips transactions already on file rather than duplicating them.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="input"
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
        />

        {preview && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-blueprint-dark">
              Found <strong>{preview.rows.length}</strong> transaction{preview.rows.length === 1 ? "" : "s"} in{" "}
              <span className="font-mono text-xs">{preview.fileName}</span>
              {preview.skippedRows > 0 && (
                <span className="text-blueprint/50"> — {preview.skippedRows} row{preview.skippedRows === 1 ? "" : "s"} skipped</span>
              )}
              .
            </p>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-blueprint/10">
              <table className="w-full text-xs">
                <tbody>
                  {preview.rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-blueprint/5 last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5 text-blueprint/60">{formatDate(r.date)}</td>
                      <td className="px-3 py-1.5">{r.description}</td>
                      <td className={`whitespace-nowrap px-3 py-1.5 text-right font-medium ${r.type === "debit" ? "text-red-600" : "text-sage-dark"}`}>
                        {r.type === "debit" ? "-" : "+"}
                        {currency(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 50 && (
                <p className="px-3 py-1.5 text-xs text-blueprint/40">…and {preview.rows.length - 50} more.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn-amber" disabled={importing} onClick={handleImport}>
                {importing ? "Importing…" : `Import ${preview.rows.length} transaction${preview.rows.length === 1 ? "" : "s"}`}
              </button>
              <button className="btn-ghost" disabled={importing} onClick={() => setPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Total paid out" value={currency(totalPaid)} tone="sage" />
        <SummaryCard label="Unmatched to a bid" value={currency(unmatchedPaid)} />
        <div className="card flex items-center justify-center p-4">
          <button className="btn-outline w-full text-sm" disabled={autoMatching} onClick={handleAutoMatch}>
            {autoMatching ? "Matching…" : "Auto-match by contractor name"}
          </button>
        </div>
      </div>

      {bids.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-blueprint-dark">Paid vs. bid, by contractor</h2>
          <div className="space-y-2">
            {bids.map((bid) => {
              const paid = debitTransactions.filter((t) => t.bid_id === bid.id).reduce((sum, t) => sum + Number(t.amount), 0);
              const remaining = Number(bid.total_amount) - paid;
              return (
                <div key={bid.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-concrete">
                  <span className="font-medium text-blueprint-dark">{bid.contractor}</span>
                  <span className="text-xs text-blueprint/50">
                    {currency(paid)} paid of {currency(bid.total_amount)} —{" "}
                    <span className={remaining > 0 ? "text-blueprint/60" : "text-sage-dark"}>
                      {remaining > 0 ? `${currency(remaining)} remaining` : "fully paid"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-blueprint-dark">All transactions ({transactions.length})</h2>
          {importSources.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {importSources.map((name) => (
                <button key={name} className="btn-ghost px-2 py-1 text-xs text-red-500" onClick={() => setUndoingSource(name)}>
                  Undo &quot;{name}&quot;
                </button>
              ))}
            </div>
          )}
        </div>

        {transactions.length === 0 ? (
          <p className="text-sm text-blueprint/50">No transactions imported yet — upload a CSV above to get started.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                className="input max-w-xs py-1.5 text-sm"
                placeholder="Search description…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
              <select className="input w-auto py-1.5 text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value as typeof filterType)}>
                <option value="all">All types</option>
                <option value="debit">Paid out</option>
                <option value="credit">Received</option>
              </select>
              <select className="input w-auto py-1.5 text-sm" value={filterBid} onChange={(e) => setFilterBid(e.target.value)}>
                <option value="all">All bids</option>
                <option value="unmatched">Unmatched</option>
                {bids.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.contractor}
                  </option>
                ))}
              </select>
              {hasActiveFilter && (
                <button
                  className="btn-ghost px-2 py-1 text-xs"
                  onClick={() => {
                    setFilterText("");
                    setFilterType("all");
                    setFilterBid("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>

            <div className="space-y-2">
              <RunningTotals
                label={`Showing ${filteredTransactions.length} of ${transactions.length}`}
                totals={totalsOf(filteredTransactions)}
              />
              {selectedIds.size > 0 && (
                <RunningTotals
                  label={`${selectedIds.size} selected`}
                  totals={totalsOf(selectedTransactions)}
                  onClear={() => setSelectedIds(new Set())}
                  emphasize
                />
              )}
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-blueprint/10 text-left text-xs uppercase tracking-wide text-blueprint/40">
                    <th className="w-8 px-2 py-2">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
                    </th>
                    <th className="px-2 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">Description</th>
                    <th className="px-2 py-2 text-right font-medium">Amount</th>
                    <th className="px-2 py-2 font-medium">Bid</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((t) => (
                    <tr key={t.id} className="group border-b border-blueprint/5 last:border-0 hover:bg-concrete">
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelected(t.id)} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs text-blueprint/60">{formatDate(t.txn_date)}</td>
                      <td className="px-2 py-1.5">{t.description}</td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right font-medium ${t.type === "debit" ? "text-red-600" : "text-sage-dark"}`}>
                        {t.type === "debit" ? "-" : "+"}
                        {currency(t.amount)}
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          className="input py-1 text-xs"
                          value={t.bid_id ?? ""}
                          onChange={(e) => handleAssignBid(t, e.target.value || null)}
                        >
                          <option value="">Unmatched</option>
                          {bids.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.contractor}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          className="text-xs text-red-500 opacity-0 hover:underline group-hover:opacity-100"
                          onClick={() => setDeleting(t)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredTransactions.length === 0 && (
                <p className="py-4 text-center text-sm text-blueprint/50">No transactions match these filters.</p>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="Delete transaction?"
        message={deleting ? `Delete "${deleting.description}" (${currency(deleting.amount)})? This cannot be undone.` : ""}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteBankTransaction(projectId, deleting.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete transaction.");
          } else {
            setTransactions((prev) => prev.filter((t) => t.id !== deleting.id));
            notify("success", "Transaction deleted.");
          }
          setDeleting(null);
        }}
      />

      <ConfirmDialog
        open={!!undoingSource}
        title="Undo this import?"
        message={
          undoingSource
            ? `Delete every transaction imported from "${undoingSource}" (${
                transactions.filter((t) => t.source_file_name === undoingSource).length
              } total)? Any bid you've assigned to them will be lost. This cannot be undone.`
            : ""
        }
        confirmLabel="Undo import"
        danger
        onCancel={() => setUndoingSource(null)}
        onConfirm={async () => {
          if (!undoingSource) return;
          const res = await deleteBankTransactionsBySource(projectId, undoingSource);
          if (!res.ok) {
            notify("error", res.error ?? "Could not undo that import.");
          } else {
            setTransactions((prev) => prev.filter((t) => t.source_file_name !== undoingSource));
            notify("success", "Import undone.");
          }
          setUndoingSource(null);
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

// A running total driven by either mechanism the table offers — filtering
// (always shown, reflects whatever's currently visible) or checkbox
// selection (shown only once something's checked, since it's an explicit
// action layered on top of filtering, not a replacement for it).
function RunningTotals({
  label,
  totals,
  onClear,
  emphasize,
}: {
  label: string;
  totals: Totals;
  onClear?: () => void;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
        emphasize ? "border border-amber-dark/30 bg-amber-dark/5" : "bg-concrete"
      }`}
    >
      <span className="font-medium text-blueprint-dark">{label}</span>
      <span className="flex flex-wrap gap-3 text-xs text-blueprint/70">
        <span>
          Paid out: <span className="font-semibold text-red-600">{currency(totals.debit)}</span>
        </span>
        <span>
          Received: <span className="font-semibold text-sage-dark">{currency(totals.credit)}</span>
        </span>
        <span>
          Net: <span className="font-semibold text-blueprint-dark">{currency(totals.net)}</span>
        </span>
        {onClear && (
          <button className="text-amber-dark hover:underline" onClick={onClear}>
            Clear
          </button>
        )}
      </span>
    </div>
  );
}
