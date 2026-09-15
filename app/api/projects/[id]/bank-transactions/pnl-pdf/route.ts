import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderBankTransactionsPdf, type BankPdfCategoryRow, type BankPdfTransaction } from "@/lib/bankTransactionsPdf";

export const runtime = "nodejs";
export const maxDuration = 30;

interface PnlPdfRequest {
  year?: string; // "all" or a 4-digit year — mirrors the client's plYear filter
}

function totalsOf(rows: { amount: number; type: "debit" | "credit" }[]) {
  const debit = rows.filter((r) => r.type === "debit").reduce((s, r) => s + Number(r.amount), 0);
  const credit = rows.filter((r) => r.type === "credit").reduce((s, r) => s + Number(r.amount), 0);
  return { debit, credit, net: credit - debit };
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = params.id;
  const body = (await req.json().catch(() => ({}))) as PnlPdfRequest;
  const year = body.year && body.year !== "all" ? body.year : "all";

  try {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("name, address")
      .eq("id", projectId)
      .single();
    if (projectError || !project) return NextResponse.json({ error: "Construction not found." }, { status: 404 });

    // Re-scoped to this project and to include_in_pl=true server-side —
    // never trust a client-computed P&L list, same reasoning as
    // house-book/route.ts re-querying every id list it's handed.
    let query = supabase
      .from("bank_transactions")
      .select("txn_date, description, amount, type, category, bid_id, source_file_name")
      .eq("project_id", projectId)
      .eq("include_in_pl", true);
    if (year !== "all") {
      query = query.gte("txn_date", `${year}-01-01`).lt("txn_date", `${Number(year) + 1}-01-01`);
    }
    const { data: rows, error: txError } = await query.order("txn_date", { ascending: true });
    if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "Nothing marked \"In P&L\" for that period yet." }, { status: 400 });
    }

    const bidIds = Array.from(new Set(rows.map((r) => r.bid_id).filter((id): id is string => !!id)));
    let contractorById = new Map<string, string>();
    if (bidIds.length > 0) {
      const { data: bids } = await supabase.from("bids").select("id, contractor").in("id", bidIds);
      contractorById = new Map((bids ?? []).map((b) => [b.id, b.contractor]));
    }

    const transactions: BankPdfTransaction[] = rows.map((r) => ({
      date: r.txn_date,
      description: r.description,
      category: r.category ?? "Uncategorized",
      type: r.type,
      amount: Number(r.amount),
      bidContractor: r.bid_id ? contractorById.get(r.bid_id) ?? null : null,
      source: r.source_file_name ?? "Manual entry",
    }));

    const categories = Array.from(new Set(transactions.map((t) => t.category))).sort();
    const categoryRows: BankPdfCategoryRow[] = categories.map((category) => {
      const inCategory = transactions.filter((t) => t.category === category);
      const totals = totalsOf(inCategory);
      return { category, debit: totals.debit, credit: totals.credit, net: totals.net };
    });
    const grandTotal = totalsOf(transactions);
    const expenseChartRows = categoryRows
      .map((row) => ({ category: row.category, amount: row.debit }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const pdfBuffer = await renderBankTransactionsPdf({
      projectName: project.name,
      projectAddress: project.address,
      yearLabel: year === "all" ? "All time" : year,
      generatedAt: new Date().toISOString(),
      categoryRows,
      grandTotal,
      expenseChartRows,
      transactions,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${project.name.replace(/[^a-z0-9]+/gi, "-")}-pnl-${year}.pdf"`,
      },
    });
  } catch (err) {
    console.error("bank-transactions pnl-pdf generation failed", err);
    const message = err instanceof Error ? err.message : "Could not generate the P&L PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
