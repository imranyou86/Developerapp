"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { BankTransaction } from "@/lib/types";

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/bank-transactions`);
}

export interface ImportTransactionInput {
  date: string; // ISO yyyy-mm-dd
  description: string;
  amount: number;
  type: "debit" | "credit";
}

// Bulk-inserts parsed CSV rows (lib/bankCsv.ts already normalized them
// client-side — no AI call in this path). Uses an upsert with
// ignoreDuplicates against the (project_id, txn_date, description, amount,
// type) unique index so re-importing a statement with an overlapping date
// range silently skips rows already on file instead of duplicating them —
// .select() after an ignored-conflict upsert only returns the rows that
// actually landed, which is what "imported" counts below.
export async function importBankTransactions(
  projectId: string,
  rows: ImportTransactionInput[],
  sourceFileName: string
): Promise<ActionResult & { insertedRows?: BankTransaction[]; duplicates?: number }> {
  if (rows.length === 0) return { ok: false, error: "No transactions to import." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("bank_transactions")
    .upsert(
      rows.map((r) => ({
        project_id: projectId,
        txn_date: r.date,
        description: r.description,
        amount: r.amount,
        type: r.type,
        source_file_name: sourceFileName,
        created_by: user.id,
      })),
      { onConflict: "project_id,txn_date,description,amount,type", ignoreDuplicates: true }
    )
    .select("id, project_id, bid_id, txn_date, description, amount, type, category, source_file_name, created_at");
  if (error) return { ok: false, error: error.message };

  revalidate(projectId);
  const insertedRows = (data ?? []) as BankTransaction[];
  return { ok: true, insertedRows, duplicates: rows.length - insertedRows.length };
}

// A row that never hits a bank statement — a cash payment, a cost folded
// into a closing statement the bank CSV won't itemize, a contributed cost,
// etc. — for tax-prep purposes these need to be trackable in the same
// ledger/P&L as imported transactions. source_file_name stays null, which
// is how the UI tells a manual entry apart from an imported one.
export async function addManualTransaction(
  projectId: string,
  input: { date: string; description: string; amount: number; type: "debit" | "credit"; category: string | null; bidId: string | null }
): Promise<ActionResult & { transaction?: BankTransaction }> {
  if (!input.description.trim()) return { ok: false, error: "Description is required." };
  if (!input.amount || input.amount <= 0) return { ok: false, error: "Enter a positive amount." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("bank_transactions")
    .insert({
      project_id: projectId,
      bid_id: input.bidId,
      txn_date: input.date,
      description: input.description.trim(),
      amount: input.amount,
      type: input.type,
      category: input.category,
      source_file_name: null,
      created_by: user.id,
    })
    .select("id, project_id, bid_id, txn_date, description, amount, type, category, source_file_name, created_at")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidate(projectId);
  return { ok: true, transaction: data as BankTransaction };
}

export async function assignTransactionBid(projectId: string, transactionId: string, bidId: string | null): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("bank_transactions").update({ bid_id: bidId }).eq("id", transactionId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function assignTransactionCategory(projectId: string, transactionId: string, category: string | null): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("bank_transactions").update({ category }).eq("id", transactionId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteBankTransaction(projectId: string, transactionId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("bank_transactions").delete().eq("id", transactionId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

// Undo a whole import at once (e.g. the wrong file was uploaded) rather
// than deleting rows one at a time.
export async function deleteBankTransactionsBySource(projectId: string, sourceFileName: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("bank_transactions")
    .delete()
    .eq("project_id", projectId)
    .eq("source_file_name", sourceFileName);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

// Cheap, deterministic matching pass (no AI call): a transaction with no
// bid yet gets linked to a bid whose contractor name appears in its
// description, but only when exactly one bid matches — an ambiguous
// description is left for the person to assign by hand rather than
// guessing wrong.
export async function autoMatchTransactions(projectId: string): Promise<ActionResult & { matches?: { id: string; bidId: string }[] }> {
  const supabase = createClient();
  const [{ data: transactions, error: txError }, { data: bids, error: bidError }] = await Promise.all([
    supabase.from("bank_transactions").select("id, description").eq("project_id", projectId).is("bid_id", null),
    supabase.from("bids").select("id, contractor").eq("project_id", projectId).neq("status", "declined"),
  ]);
  if (txError) return { ok: false, error: txError.message };
  if (bidError) return { ok: false, error: bidError.message };
  if (!transactions?.length || !bids?.length) return { ok: true, matches: [] };

  const candidates = bids.filter((b) => b.contractor.trim().length > 0);
  const matches: { id: string; bidId: string }[] = [];
  for (const txn of transactions) {
    const desc = txn.description.toLowerCase();
    const hits = candidates.filter((b) => desc.includes(b.contractor.trim().toLowerCase()));
    if (hits.length === 1) {
      const { error } = await supabase.from("bank_transactions").update({ bid_id: hits[0].id }).eq("id", txn.id);
      if (!error) matches.push({ id: txn.id, bidId: hits[0].id });
    }
  }

  revalidate(projectId);
  return { ok: true, matches };
}
