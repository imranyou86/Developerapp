"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { parseBankCsv, type ParsedBankTransaction } from "@/lib/bankCsv";
import { BANK_TXN_CATEGORIES } from "@/lib/bankCategories";
import { stripLeadingZero } from "@/lib/numberInput";
import {
  addManualTransaction,
  assignTransactionBid,
  assignTransactionCategory,
  autoMatchTransactions,
  deleteBankTransaction,
  deleteBankTransactionsBySource,
  importBankTransactions,
  setTransactionsIncludeInPl,
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

// Works for both already-imported rows (BankTransaction) and freshly-parsed
// preview rows (ParsedBankTransaction) — both just need amount/type.
function totalsOf(rows: { amount: number; type: "debit" | "credit" }[]): Totals {
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
  const [previewFilterText, setPreviewFilterText] = useState("");
  // Indexes into preview.rows to leave OUT of the import — unchecked means
  // "will be imported", so a fresh preview starts with nothing excluded
  // (import everything found, as before) and unchecking a row is how you
  // exclude a one-off personal charge or the like.
  const [excludedPreviewIndexes, setExcludedPreviewIndexes] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);
  const [deleting, setDeleting] = useState<BankTransaction | null>(null);
  const [undoingSource, setUndoingSource] = useState<string | null>(null);

  const [filterText, setFilterText] = useState("");
  const [filterType, setFilterType] = useState<"all" | "debit" | "credit">("all");
  const [filterBid, setFilterBid] = useState<BidFilter>("all");
  const [filterCategory, setFilterCategory] = useState<"all" | "uncategorized" | string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addingManual, setAddingManual] = useState(false);
  const [plYear, setPlYear] = useState<"all" | string>("all");
  const [showExpenseChart, setShowExpenseChart] = useState(false);

  const bidsById = new Map(bids.map((b) => [b.id, b.contractor]));

  const hasActiveFilter = filterText.trim() !== "" || filterType !== "all" || filterBid !== "all" || filterCategory !== "all";

  const filteredTransactions = transactions.filter((t) => {
    if (filterType !== "all" && t.type !== filterType) return false;
    if (filterBid === "unmatched" && t.bid_id) return false;
    if (filterBid !== "all" && filterBid !== "unmatched" && t.bid_id !== filterBid) return false;
    if (filterCategory === "uncategorized" && t.category) return false;
    if (filterCategory !== "all" && filterCategory !== "uncategorized" && t.category !== filterCategory) return false;
    if (filterText.trim() && !t.description.toLowerCase().includes(filterText.trim().toLowerCase())) return false;
    return true;
  });

  // Pairs each preview row with its original index so filtering (which
  // narrows what's shown) never loses track of which row an exclude
  // checkbox actually applies to.
  const previewEntries = preview ? preview.rows.map((row, index) => ({ row, index })) : [];
  const filteredPreviewEntries = previewEntries.filter(
    ({ row }) => !previewFilterText.trim() || row.description.toLowerCase().includes(previewFilterText.trim().toLowerCase())
  );
  const filteredPreviewIndexes = filteredPreviewEntries.map((e) => e.index);
  const allFilteredPreviewIncluded =
    filteredPreviewIndexes.length > 0 && filteredPreviewIndexes.every((i) => !excludedPreviewIndexes.has(i));
  const includedPreviewRows = preview ? preview.rows.filter((_, i) => !excludedPreviewIndexes.has(i)) : [];

  function togglePreviewExcluded(index: number) {
    setExcludedPreviewIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleIncludeAllFilteredPreview() {
    setExcludedPreviewIndexes((prev) => {
      const next = new Set(prev);
      if (allFilteredPreviewIncluded) {
        filteredPreviewIndexes.forEach((i) => next.add(i));
      } else {
        filteredPreviewIndexes.forEach((i) => next.delete(i));
      }
      return next;
    });
  }

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
    setPreviewFilterText("");
    setExcludedPreviewIndexes(new Set());
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
    if (!preview || includedPreviewRows.length === 0) return;
    setImporting(true);
    try {
      const res = await importBankTransactions(projectId, includedPreviewRows, preview.fileName);
      if (!res.ok) {
        notify("error", res.error ?? "Import failed.");
        return;
      }
      setTransactions((prev) => [...(res.insertedRows ?? []), ...prev]);
      const excludedNote = excludedPreviewIndexes.size > 0 ? ` (${excludedPreviewIndexes.size} excluded)` : "";
      const skippedNote = preview.skippedRows > 0 ? ` (${preview.skippedRows} row${preview.skippedRows === 1 ? "" : "s"} skipped — unrecognized)` : "";
      const dupeNote = res.duplicates ? `, ${res.duplicates} already on file` : "";
      notify(
        "success",
        `Imported ${res.insertedRows?.length ?? 0} transaction${res.insertedRows?.length === 1 ? "" : "s"}${dupeNote}.${excludedNote}${skippedNote}`
      );
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

  async function handleAssignCategory(txn: BankTransaction, category: string | null) {
    const prev = txn.category;
    setTransactions((rows) => rows.map((r) => (r.id === txn.id ? { ...r, category } : r)));
    const res = await assignTransactionCategory(projectId, txn.id, category);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update.");
      setTransactions((rows) => rows.map((r) => (r.id === txn.id ? { ...r, category: prev } : r)));
    }
  }

  async function handleToggleIncludeInPl(txn: BankTransaction) {
    const next = !txn.include_in_pl;
    setTransactions((rows) => rows.map((r) => (r.id === txn.id ? { ...r, include_in_pl: next } : r)));
    const res = await setTransactionsIncludeInPl(projectId, [txn.id], next);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update.");
      setTransactions((rows) => rows.map((r) => (r.id === txn.id ? { ...r, include_in_pl: !next } : r)));
    }
  }

  async function handleBulkSetIncludeInPl(include: boolean) {
    const ids = selectedTransactions.map((t) => t.id);
    if (ids.length === 0) return;
    setTransactions((rows) => rows.map((r) => (ids.includes(r.id) ? { ...r, include_in_pl: include } : r)));
    const res = await setTransactionsIncludeInPl(projectId, ids, include);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update.");
      setTransactions((rows) => rows.map((r) => (ids.includes(r.id) ? { ...r, include_in_pl: !include } : r)));
    } else {
      notify("success", `${ids.length} transaction${ids.length === 1 ? "" : "s"} ${include ? "added to" : "removed from"} the P&L.`);
    }
  }

  function handleExportCsv() {
    const header = ["Date", "Description", "Category", "Type", "Amount", "In P&L", "Bid", "Source"];
    const rows = transactions.map((t) => [
      t.txn_date,
      t.description,
      t.category ?? "",
      t.type,
      String(t.amount),
      t.include_in_pl ? "Yes" : "No",
      t.bid_id ? (bidsById.get(t.bid_id) ?? "") : "",
      t.source_file_name ?? "Manual entry",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bank-transactions.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

  // Profit & Loss — only rows explicitly marked include_in_pl (not every
  // imported/manual row by default — a bank feed's debits aren't all real
  // expenses, e.g. a transfer between the owner's own accounts), scoped to
  // one tax year at a time so it's comparable year over year, or "All time"
  // for the whole project's lifetime numbers. Never limited by the browse
  // filters above — those are for finding specific rows, not for deciding
  // what counts as income/expense.
  const plEligible = transactions.filter((t) => t.include_in_pl);
  const availableYears = Array.from(new Set(transactions.map((t) => t.txn_date.slice(0, 4)))).sort((a, b) => b.localeCompare(a));
  const plTransactions = plYear === "all" ? plEligible : plEligible.filter((t) => t.txn_date.startsWith(plYear));
  const plCategories = Array.from(new Set(plTransactions.map((t) => t.category ?? "Uncategorized"))).sort();
  const plRows = plCategories.map((category) => ({
    category,
    totals: totalsOf(plTransactions.filter((t) => (t.category ?? "Uncategorized") === category)),
  }));
  const plGrandTotal = totalsOf(plTransactions);
  // Expense breakdown chart data — debit side of plRows only, ranked
  // largest-first. Reuses the same category grouping as the P&L table
  // (its exact numbers), just rendered as bar length instead of text.
  const expenseByCategory = plRows
    .map((row) => ({ category: row.category, amount: row.totals.debit }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-blueprint-dark">Import bank transactions</h2>
          <button className="btn-outline px-3 py-1.5 text-xs" onClick={() => setAddingManual(true)}>
            + Add manual entry
          </button>
        </div>
        <p className="mb-4 text-xs text-blueprint/50">
          Upload a CSV exported from your bank — most common formats are recognized automatically (a single signed
          Amount column, separate Debit/Credit columns, or a headerless Wells Fargo-style export). Re-importing an
          overlapping date range skips transactions already on file rather than duplicating them. For costs that
          never hit the bank statement (a cash payment, closing costs the bank CSV won&apos;t itemize, etc.), use
          &quot;Add manual entry&quot; instead — it belongs in the same ledger for tax prep.
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
              . Everything&apos;s checked to import by default — uncheck a row (or filter down and uncheck a batch)
              to leave it out, e.g. a personal charge mixed into the statement.
            </p>

            <input
              className="input max-w-xs py-1.5 text-sm"
              placeholder="Filter by description…"
              value={previewFilterText}
              onChange={(e) => setPreviewFilterText(e.target.value)}
            />
            <div className="space-y-2">
              <RunningTotals
                label={`Showing ${filteredPreviewEntries.length} of ${preview.rows.length}`}
                totals={totalsOf(filteredPreviewEntries.map((e) => e.row))}
              />
              <RunningTotals
                label={`${includedPreviewRows.length} of ${preview.rows.length} will be imported`}
                totals={totalsOf(includedPreviewRows)}
                emphasize
              />
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-blueprint/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-blueprint/10 text-left">
                    <th className="w-6 px-3 py-1.5">
                      <input type="checkbox" checked={allFilteredPreviewIncluded} onChange={toggleIncludeAllFilteredPreview} />
                    </th>
                    <th colSpan={3} className="px-3 py-1.5 font-normal text-blueprint/40">
                      Check/uncheck all shown
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPreviewEntries.slice(0, 50).map(({ row: r, index }) => (
                    <tr key={index} className="border-b border-blueprint/5 last:border-0">
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={!excludedPreviewIndexes.has(index)} onChange={() => togglePreviewExcluded(index)} />
                      </td>
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
              {filteredPreviewEntries.length > 50 && (
                <p className="px-3 py-1.5 text-xs text-blueprint/40">…and {filteredPreviewEntries.length - 50} more.</p>
              )}
              {filteredPreviewEntries.length === 0 && (
                <p className="px-3 py-1.5 text-xs text-blueprint/40">No rows match that filter.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn-amber" disabled={importing || includedPreviewRows.length === 0} onClick={handleImport}>
                {importing ? "Importing…" : `Import ${includedPreviewRows.length} transaction${includedPreviewRows.length === 1 ? "" : "s"}`}
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
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-blueprint-dark">Profit &amp; Loss</h2>
          <div className="flex items-center gap-2">
            <select className="input w-auto py-1.5 text-sm" value={plYear} onChange={(e) => setPlYear(e.target.value)}>
              <option value="all">All time</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={handleExportCsv}>
              Export ledger to CSV
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-blueprint/50">
          Only transactions checked &quot;In P&amp;L&quot; below count here — not everything imported. Mark rows one at
          a time, or select several (filter first to narrow them down) and use &quot;Add selected to P&amp;L&quot;.
          Grouped by category, scoped to the selected year so it&apos;s comparable year over year. This is a computed
          summary of what&apos;s marked, not tax advice — confirm categorization and treatment with whoever prepares
          the return.
        </p>
        {plTransactions.length === 0 ? (
          <p className="text-sm text-blueprint/50">
            {plEligible.length === 0
              ? "Nothing marked for the P&L yet — check \"In P&L\" on rows below, or select some and use \"Add selected to P&L\"."
              : "Nothing marked for this year."}
          </p>
        ) : (
          <>
            {expenseByCategory.length > 0 && (
              <button className="btn-ghost mb-3 px-2 py-1 text-xs" onClick={() => setShowExpenseChart((v) => !v)}>
                {showExpenseChart ? "Hide expense chart" : "Generate expense chart"}
              </button>
            )}
            {showExpenseChart && expenseByCategory.length > 0 && (
              <ExpenseBreakdownChart rows={expenseByCategory} total={plGrandTotal.debit} />
            )}
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-blueprint/10 text-left text-xs uppercase tracking-wide text-blueprint/40">
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-2 py-2 text-right font-medium">Paid out</th>
                  <th className="px-2 py-2 text-right font-medium">Received</th>
                  <th className="px-2 py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {plRows.map((row) => (
                  <tr key={row.category} className="border-b border-blueprint/5 last:border-0">
                    <td className="px-2 py-1.5">{row.category}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-red-600">{currency(row.totals.debit)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-sage-dark">{currency(row.totals.credit)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium text-blueprint-dark">{currency(row.totals.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-blueprint/20 font-semibold">
                  <td className="px-2 py-2">Total</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right text-red-600">{currency(plGrandTotal.debit)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right text-sage-dark">{currency(plGrandTotal.credit)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right text-blueprint-dark">{currency(plGrandTotal.net)}</td>
                </tr>
              </tfoot>
            </table>
            </div>
          </>
        )}
      </div>

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
              <select className="input w-auto py-1.5 text-sm" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                <option value="all">All categories</option>
                <option value="uncategorized">Uncategorized</option>
                {BANK_TXN_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
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
                    setFilterCategory("all");
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
                >
                  <button className="text-amber-dark hover:underline" onClick={() => handleBulkSetIncludeInPl(true)}>
                    Add selected to P&amp;L
                  </button>
                  <button className="text-amber-dark hover:underline" onClick={() => handleBulkSetIncludeInPl(false)}>
                    Remove selected from P&amp;L
                  </button>
                </RunningTotals>
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
                    <th className="px-2 py-2 font-medium">Category</th>
                    <th className="px-2 py-2 font-medium">Bid</th>
                    <th className="px-2 py-2 text-center font-medium" title="Counts toward the Profit &amp; Loss statement">
                      In P&amp;L
                    </th>
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
                      <td className="px-2 py-1.5">
                        {t.description}
                        {!t.source_file_name && (
                          <span className="ml-1.5 rounded bg-blueprint/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blueprint/50">
                            Manual
                          </span>
                        )}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right font-medium ${t.type === "debit" ? "text-red-600" : "text-sage-dark"}`}>
                        {t.type === "debit" ? "-" : "+"}
                        {currency(t.amount)}
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          className="input py-1 text-xs"
                          value={t.category ?? ""}
                          onChange={(e) => handleAssignCategory(t, e.target.value || null)}
                        >
                          <option value="">Uncategorized</option>
                          {BANK_TXN_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
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
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={t.include_in_pl} onChange={() => handleToggleIncludeInPl(t)} />
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

      {addingManual && (
        <ManualEntryModal
          bids={bids}
          onClose={() => setAddingManual(false)}
          onSave={async (input) => {
            const res = await addManualTransaction(projectId, input);
            if (!res.ok || !res.transaction) {
              notify("error", res.error ?? "Could not add entry.");
              return;
            }
            setTransactions((prev) => [res.transaction!, ...prev]);
            notify("success", "Entry added.");
            setAddingManual(false);
          }}
        />
      )}
    </div>
  );
}

function ManualEntryModal({
  bids,
  onClose,
  onSave,
}: {
  bids: BidOption[];
  onClose: () => void;
  onSave: (input: {
    date: string;
    description: string;
    amount: number;
    type: "debit" | "credit";
    category: string | null;
    bidId: string | null;
    includeInPl: boolean;
  }) => Promise<void>;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"debit" | "credit">("debit");
  const [category, setCategory] = useState("");
  const [bidId, setBidId] = useState("");
  // Defaults checked, unlike a bulk CSV import — a manual entry is one
  // deliberate action the person is taking right now, not unreviewed bulk
  // data, so it's reasonable to assume they mean for it to count.
  const [includeInPl, setIncludeInPl] = useState(true);
  const [saving, setSaving] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title="Add manual entry"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={saving || !description.trim() || !amount}
            onClick={async () => {
              setSaving(true);
              await onSave({
                date,
                description: description.trim(),
                amount: Number(amount) || 0,
                type,
                category: category || null,
                bidId: bidId || null,
                includeInPl,
              });
              setSaving(false);
            }}
          >
            {saving ? "Saving…" : "Add entry"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-blueprint/50">
          For a cost or payment that never hits a bank statement — a cash payment, closing costs the bank CSV won&apos;t
          itemize, etc. It&apos;s added to the same ledger as imported transactions.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="debit">Paid out</option>
              <option value="credit">Received</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Property acquisition — closing costs"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
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
          <div>
            <label className="label">Category (optional)</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Uncategorized</option>
              {BANK_TXN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-blueprint-dark">
          <input type="checkbox" checked={includeInPl} onChange={(e) => setIncludeInPl(e.target.checked)} />
          Include in Profit &amp; Loss
        </label>
        {bids.length > 0 && (
          <div>
            <label className="label">Bid (optional)</label>
            <select className="input" value={bidId} onChange={(e) => setBidId(e.target.value)}>
              <option value="">Unmatched</option>
              {bids.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.contractor}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Horizontal bars, ranked largest-first — the read here is "which category
// dominates spending," so magnitude order does the work; a legend would be
// redundant since every bar already carries its own category label. One
// fixed hue (the same red used for "paid out" everywhere else in this tab)
// rather than a per-bar lightness ramp: ramping each bar's shade by its OWN
// value would double-encode the length it already shows and (since these
// categories have no inherent order) fails for the same reason a value-tint
// on nominal categories always does. Bars are capped at 24px thick with a
// 4px rounded end away from the baseline, matching every other mark in the
// app's tables. The P&L table directly below is this chart's exact
// table-view twin — same numbers, so nothing here is chart-only.
function ExpenseBreakdownChart({ rows, total }: { rows: { category: string; amount: number }[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.amount));
  return (
    <div className="mb-4 rounded-lg border border-blueprint/10 p-3" role="img" aria-label="Expense breakdown by category, largest first">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-blueprint/40">Expenses by category</span>
        <span className="text-xs text-blueprint/50">
          Total: <span className="font-semibold text-red-600">{currency(total)}</span>
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const pct = max > 0 ? (r.amount / max) * 100 : 0;
          return (
            <div key={r.category} className="group flex items-center gap-2">
              <span className="w-36 shrink-0 truncate text-xs text-blueprint/70" title={r.category}>
                {r.category}
              </span>
              <div className="h-6 min-w-0 flex-1 overflow-hidden rounded bg-concrete">
                <div
                  className="h-6 rounded-r bg-red-600 transition-colors group-hover:bg-red-700"
                  style={{ width: `${pct}%` }}
                  title={`${r.category}: ${currency(r.amount)}`}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums text-blueprint-dark">{currency(r.amount)}</span>
            </div>
          );
        })}
      </div>
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
  children,
}: {
  label: string;
  totals: Totals;
  onClear?: () => void;
  emphasize?: boolean;
  children?: React.ReactNode;
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
        {children}
        {onClear && (
          <button className="text-amber-dark hover:underline" onClick={onClear}>
            Clear
          </button>
        )}
      </span>
    </div>
  );
}
