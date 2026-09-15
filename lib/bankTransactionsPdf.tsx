import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitHelvetica from "pdfkit/standard-fonts/Helvetica";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitHelveticaBold from "pdfkit/standard-fonts/HelveticaBold";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitHelveticaOblique from "pdfkit/standard-fonts/HelveticaOblique";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitTimesBold from "pdfkit/standard-fonts/TimesBold";

// Server-only — generates the Bank Transactions tab's "Export PDF for CPA"
// document (app/api/projects/[id]/bank-transactions/pnl-pdf/route.ts). Same
// base-14-font-only approach as lib/houseBookPdf.tsx, and the same reason
// for the otherwise-unused imports above: pdfkit only ever reaches its
// standard-font files via a computed require() that Vercel's file tracing
// can't follow, so a literal import of the exact subpath forces these into
// THIS file's own bundled output instead of relying on that trace. One
// import per font family actually used in the styles below (Helvetica,
// Helvetica-Bold, Helvetica-Oblique, Times-Bold).
void [PdfkitHelvetica, PdfkitHelveticaBold, PdfkitHelveticaOblique, PdfkitTimesBold];

export interface BankPdfCategoryRow {
  category: string;
  debit: number;
  credit: number;
  net: number;
}

export interface BankPdfTransaction {
  date: string; // ISO yyyy-mm-dd
  description: string;
  category: string; // already normalized to "Uncategorized" where null
  type: "debit" | "credit";
  amount: number;
  bidContractor: string | null;
  source: string; // a file name, or "Manual entry"
}

export interface BankTransactionsPdfInput {
  projectName: string;
  projectAddress: string | null;
  yearLabel: string; // "All time" or a 4-digit year
  generatedAt: string; // ISO timestamp
  categoryRows: BankPdfCategoryRow[];
  grandTotal: { debit: number; credit: number; net: number };
  // Debit-only, sorted largest-first — same shape and ordering as the
  // in-app expense chart, so the two never disagree on ranking.
  expenseChartRows: { category: string; amount: number }[];
  // Sorted chronologically before being grouped by category below.
  transactions: BankPdfTransaction[];
}

function currency(n: number): string {
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Same accent colors the on-screen tab already uses for these numbers
// (text-red-600 / text-sage-dark / text-blueprint-dark in
// bank-transactions-client.tsx) — this report is a printable extension of
// that view, not a separate "keepsake" document like the House Book, so it
// deliberately reuses the app's own accounting colors rather than a
// decorative palette.
const EXPENSE_COLOR = "#DC2626";
const REVENUE_COLOR = "#2C8557";
const HEADING_COLOR = "#123E80";
const MUTED_COLOR = "#5b6470";
const FAINT_COLOR = "#9aa0a6";
const BORDER_COLOR = "#dcdfe3";
const TRACK_COLOR = "#eef1f3";

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 48,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: "#2b2b2b",
  },
  header: {
    position: "absolute",
    top: 22,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8.5,
    color: FAINT_COLOR,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER_COLOR,
    paddingBottom: 6,
  },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: FAINT_COLOR,
  },
  title: {
    fontFamily: "Times-Bold",
    fontSize: 22,
    color: HEADING_COLOR,
  },
  titleRule: {
    width: 40,
    height: 2,
    backgroundColor: EXPENSE_COLOR,
    marginTop: 6,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginBottom: 18,
  },
  metaText: {
    fontSize: 9,
    color: MUTED_COLOR,
  },
  statRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  statTile: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: BORDER_COLOR,
    borderRadius: 4,
    padding: 10,
  },
  statLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: FAINT_COLOR,
    marginBottom: 4,
  },
  statValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 15,
  },
  sectionHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: HEADING_COLOR,
    marginBottom: 8,
    marginTop: 4,
  },
  chartWrap: {
    borderWidth: 0.75,
    borderColor: BORDER_COLOR,
    borderRadius: 4,
    padding: 10,
    marginBottom: 20,
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  chartLabel: {
    width: 120,
    fontSize: 8.5,
    color: MUTED_COLOR,
  },
  chartTrack: {
    flex: 1,
    height: 10,
    borderRadius: 3,
    backgroundColor: TRACK_COLOR,
  },
  chartFill: {
    height: 10,
    borderRadius: 3,
    backgroundColor: EXPENSE_COLOR,
  },
  chartValue: {
    width: 62,
    textAlign: "right",
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: HEADING_COLOR,
  },
  table: {
    marginBottom: 20,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER_COLOR,
    paddingVertical: 5,
  },
  tableHeaderRow: {
    borderBottomWidth: 1,
    borderBottomColor: HEADING_COLOR,
    paddingBottom: 4,
  },
  tableTotalRow: {
    borderTopWidth: 1.25,
    borderTopColor: HEADING_COLOR,
    borderBottomWidth: 0,
    marginTop: 2,
    paddingTop: 6,
  },
  tableCell: {
    fontSize: 9,
  },
  headerCell: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: FAINT_COLOR,
  },
  boldCell: {
    fontFamily: "Helvetica-Bold",
  },
  colCategory: {
    flex: 1,
  },
  colAmount: {
    width: 90,
    textAlign: "right",
  },
  disclaimer: {
    fontSize: 8,
    fontFamily: "Helvetica-Oblique",
    color: FAINT_COLOR,
    lineHeight: 1.4,
  },
  categoryHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    color: HEADING_COLOR,
    marginTop: 12,
    marginBottom: 3,
  },
  detailRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER_COLOR,
    paddingVertical: 4,
  },
  detailCell: {
    fontSize: 8.5,
  },
  colDate: {
    width: 62,
    color: MUTED_COLOR,
  },
  colDesc: {
    flex: 1,
    paddingRight: 6,
  },
  colSource: {
    width: 96,
    color: FAINT_COLOR,
  },
  colAmountSm: {
    width: 64,
    textAlign: "right",
  },
  subtotalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    marginBottom: 2,
  },
  subtotalLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: HEADING_COLOR,
    textAlign: "right",
    paddingRight: 6,
  },
  subtotalValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: HEADING_COLOR,
  },
});

function PageChrome({ projectName, yearLabel }: { projectName: string; yearLabel: string }) {
  return (
    <>
      <View style={styles.header} fixed>
        <Text>{projectName}</Text>
        <Text>Profit &amp; Loss — {yearLabel}</Text>
      </View>
      <View style={styles.footer} fixed>
        <Text>Not tax advice — confirm categorization and treatment with your CPA.</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

interface CategoryGroup {
  category: string;
  rows: BankPdfTransaction[];
  subtotal: number;
}

// Groups the (already date-sorted) transaction list by category, in the
// same order categoryRows already appears in — so the detail section's
// category order always matches the summary table directly above it.
function groupByCategory(transactions: BankPdfTransaction[], categoryRows: BankPdfCategoryRow[]): CategoryGroup[] {
  const byCategory = new Map<string, BankPdfTransaction[]>();
  for (const t of transactions) {
    const list = byCategory.get(t.category);
    if (list) list.push(t);
    else byCategory.set(t.category, [t]);
  }
  return categoryRows
    .filter((row) => byCategory.has(row.category))
    .map((row) => ({ category: row.category, rows: byCategory.get(row.category)!, subtotal: row.net }));
}

export function BankTransactionsPdfDocument({ input }: { input: BankTransactionsPdfInput }) {
  const { projectName, projectAddress, yearLabel, generatedAt, categoryRows, grandTotal, expenseChartRows, transactions } = input;
  const maxExpense = expenseChartRows.length > 0 ? expenseChartRows[0].amount : 0;
  const groups = groupByCategory(transactions, categoryRows);
  const generatedLabel = new Date(generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <Document title={`${projectName} — Profit & Loss (${yearLabel})`} author="Alaia Homes Dev">
      <Page size="LETTER" style={styles.page}>
        <PageChrome projectName={projectName} yearLabel={yearLabel} />
        <Text style={styles.title}>Profit &amp; Loss Statement</Text>
        <View style={styles.titleRule} />
        <View style={styles.metaRow}>
          {projectAddress && <Text style={styles.metaText}>{projectAddress}</Text>}
          <Text style={styles.metaText}>Period: {yearLabel}</Text>
          <Text style={styles.metaText}>Generated {generatedLabel}</Text>
        </View>

        <View style={styles.statRow}>
          <StatTile label="Total expenses" value={currency(grandTotal.debit)} color={EXPENSE_COLOR} />
          <StatTile label="Total revenue" value={currency(grandTotal.credit)} color={REVENUE_COLOR} />
          <StatTile label="Net" value={currency(grandTotal.net)} color={HEADING_COLOR} />
        </View>

        {expenseChartRows.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Expense breakdown by category</Text>
            <View style={styles.chartWrap}>
              {expenseChartRows.map((row) => (
                <View key={row.category} style={styles.chartRow} wrap={false}>
                  <Text style={styles.chartLabel}>{row.category}</Text>
                  <View style={styles.chartTrack}>
                    <View style={[styles.chartFill, { width: `${maxExpense > 0 ? (row.amount / maxExpense) * 100 : 0}%` }]} />
                  </View>
                  <Text style={styles.chartValue}>{currency(row.amount)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionHeading}>Summary by category</Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeaderRow]}>
            <Text style={[styles.headerCell, styles.colCategory]}>Category</Text>
            <Text style={[styles.headerCell, styles.colAmount]}>Paid out</Text>
            <Text style={[styles.headerCell, styles.colAmount]}>Received</Text>
            <Text style={[styles.headerCell, styles.colAmount]}>Net</Text>
          </View>
          {categoryRows.map((row) => (
            <View key={row.category} style={styles.tableRow} wrap={false}>
              <Text style={[styles.tableCell, styles.colCategory]}>{row.category}</Text>
              <Text style={[styles.tableCell, styles.colAmount, { color: EXPENSE_COLOR }]}>{currency(row.debit)}</Text>
              <Text style={[styles.tableCell, styles.colAmount, { color: REVENUE_COLOR }]}>{currency(row.credit)}</Text>
              <Text style={[styles.tableCell, styles.colAmount, styles.boldCell]}>{currency(row.net)}</Text>
            </View>
          ))}
          <View style={[styles.tableRow, styles.tableTotalRow]} wrap={false}>
            <Text style={[styles.tableCell, styles.colCategory, styles.boldCell]}>Total</Text>
            <Text style={[styles.tableCell, styles.colAmount, styles.boldCell, { color: EXPENSE_COLOR }]}>{currency(grandTotal.debit)}</Text>
            <Text style={[styles.tableCell, styles.colAmount, styles.boldCell, { color: REVENUE_COLOR }]}>{currency(grandTotal.credit)}</Text>
            <Text style={[styles.tableCell, styles.colAmount, styles.boldCell]}>{currency(grandTotal.net)}</Text>
          </View>
        </View>

        <Text style={styles.disclaimer}>
          This statement totals only the transactions marked &quot;In P&amp;L&quot; in Alaia Homes Dev for the period
          above — it is a computed summary, not tax advice. Confirm categorization, capitalization, and deductibility
          with your CPA before filing. The detailed transaction listing that supports every number above follows on
          the next page.
        </Text>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <PageChrome projectName={projectName} yearLabel={yearLabel} />
        <Text style={styles.sectionHeading}>Detailed transactions, by category</Text>
        <View style={[styles.detailRow, styles.tableHeaderRow]} fixed>
          <Text style={[styles.headerCell, styles.colDate]}>Date</Text>
          <Text style={[styles.headerCell, styles.colDesc]}>Description</Text>
          <Text style={[styles.headerCell, styles.colSource]}>Source</Text>
          <Text style={[styles.headerCell, styles.colAmountSm]}>Amount</Text>
        </View>
        {groups.map((group) => (
          <View key={group.category}>
            <Text style={styles.categoryHeading} wrap={false}>
              {group.category}
            </Text>
            {group.rows.map((t, i) => (
              <View key={i} style={styles.detailRow} wrap={false}>
                <Text style={[styles.detailCell, styles.colDate]}>{formatDate(t.date)}</Text>
                <Text style={[styles.detailCell, styles.colDesc]}>
                  {t.description}
                  {t.bidContractor ? ` — ${t.bidContractor}` : ""}
                </Text>
                <Text style={[styles.detailCell, styles.colSource]}>{t.source}</Text>
                <Text style={[styles.detailCell, styles.colAmountSm, { color: t.type === "debit" ? EXPENSE_COLOR : REVENUE_COLOR }]}>
                  {t.type === "debit" ? "-" : "+"}
                  {currency(t.amount)}
                </Text>
              </View>
            ))}
            <View style={styles.subtotalRow} wrap={false}>
              <Text style={[styles.detailCell, styles.colDate]} />
              <Text style={[styles.detailCell, styles.colDesc, styles.subtotalLabel]}>Category net</Text>
              <Text style={[styles.detailCell, styles.colSource]} />
              <Text style={[styles.detailCell, styles.colAmountSm, styles.subtotalValue]}>{currency(group.subtotal)}</Text>
            </View>
          </View>
        ))}
        <View style={[styles.detailRow, styles.tableTotalRow]} wrap={false}>
          <Text style={[styles.detailCell, styles.colDate]} />
          <Text style={[styles.detailCell, styles.colDesc, styles.boldCell]}>Grand total, net</Text>
          <Text style={[styles.detailCell, styles.colSource]} />
          <Text style={[styles.detailCell, styles.colAmountSm, styles.boldCell]}>{currency(grandTotal.net)}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderBankTransactionsPdf(input: BankTransactionsPdfInput): Promise<Buffer> {
  return renderToBuffer(<BankTransactionsPdfDocument input={input} />);
}
