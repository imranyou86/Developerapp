// Parses an exported bank-transaction CSV into normalized rows. Deterministic,
// no AI call — unlike a bid PDF or inspection photo, a bank CSV is already
// structured tabular data; the only real problem is that every bank names
// (and orders) its columns differently, which a handful of header aliases
// and a couple of well-known headerless layouts (e.g. Wells Fargo) covers.

export interface ParsedBankTransaction {
  date: string; // ISO yyyy-mm-dd
  description: string;
  amount: number; // always positive — see `type` for direction
  type: "debit" | "credit";
}

export interface BankCsvParseResult {
  transactions: ParsedBankTransaction[];
  skippedRows: number;
  warning: string | null;
}

// Splits one CSV line into fields, honoring double-quoted fields that may
// contain commas (bank-exported descriptions/memos sometimes do).
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

const DATE_HEADER_ALIASES = ["date", "posting date", "posted date", "transaction date", "post date"];
// "description" listed first and matched with priority below — some banks
// export both a "Description" column (the actual payee/memo) and a
// separate "Detail"/"Details" column (a transaction-type code, e.g.
// "DEBIT"/"ACH_DEBIT"), and "Description" is always the one that matters;
// "detail(s)" is deliberately NOT in this list so it's never picked up.
const DESCRIPTION_HEADER_ALIASES = ["description", "payee", "memo", "name", "transaction"];
const AMOUNT_HEADER_ALIASES = ["amount"];
const DEBIT_HEADER_ALIASES = ["debit", "withdrawal", "withdrawals", "payment", "debit amount"];
const CREDIT_HEADER_ALIASES = ["credit", "deposit", "deposits", "credit amount"];

// Matches by alias priority, not leftmost column — checks each alias in
// order and returns the first one found anywhere in the header row, so a
// more specific/preferred alias (e.g. "description") always wins over a
// looser synonym (e.g. "memo") regardless of which column comes first.
function findColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h.toLowerCase().trim() === alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

// Accepts M/D/YYYY, MM/DD/YYYY, YYYY-MM-DD, and M-D-YYYY — the formats
// every major US bank export uses. Returns null (skip the row) rather than
// guessing at anything else.
function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

// Strips $ / commas / parens-as-negative and returns a signed number, or
// null if the field isn't a money value at all (blank cell, header noise).
function parseMoney(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[()$,]/g, "");
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return negative ? -Math.abs(n) : n;
}

export function parseBankCsv(csvText: string): BankCsvParseResult {
  const lines = csvText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { transactions: [], skippedRows: 0, warning: "The file is empty." };

  const headerFields = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const dateCol = findColumn(headerFields, DATE_HEADER_ALIASES);
  const descCol = findColumn(headerFields, DESCRIPTION_HEADER_ALIASES);
  const amountCol = findColumn(headerFields, AMOUNT_HEADER_ALIASES);
  const debitCol = findColumn(headerFields, DEBIT_HEADER_ALIASES);
  const creditCol = findColumn(headerFields, CREDIT_HEADER_ALIASES);

  const hasHeader = dateCol !== -1 && descCol !== -1 && (amountCol !== -1 || debitCol !== -1 || creditCol !== -1);

  // Wells Fargo (and a few others) export with no header row at all, in a
  // fixed 5-column layout: Date, Amount, *, *, Description.
  const firstDataLine = hasHeader ? null : splitCsvLine(lines[0]);
  const looksHeaderless =
    !hasHeader && firstDataLine !== null && firstDataLine.length >= 5 && parseDate(firstDataLine[0]) !== null && parseMoney(firstDataLine[1]) !== null;

  if (!hasHeader && !looksHeaderless) {
    return {
      transactions: [],
      skippedRows: 0,
      warning: "Couldn't recognize this file's columns — expected a Date, Description, and Amount (or Debit/Credit) column.",
    };
  }

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const transactions: ParsedBankTransaction[] = [];
  let skippedRows = 0;

  for (const line of dataLines) {
    const fields = splitCsvLine(line);
    let dateStr: string | null;
    let description: string;
    let amount: number | null = null;
    let type: "debit" | "credit" | null = null;

    if (looksHeaderless) {
      dateStr = parseDate(fields[0] ?? "");
      const signed = parseMoney(fields[1] ?? "");
      description = (fields[4] ?? "").trim();
      if (signed !== null) {
        amount = Math.abs(signed);
        type = signed < 0 ? "debit" : "credit";
      }
    } else {
      dateStr = parseDate(fields[dateCol] ?? "");
      description = (fields[descCol] ?? "").trim();
      if (amountCol !== -1) {
        const signed = parseMoney(fields[amountCol] ?? "");
        if (signed !== null) {
          amount = Math.abs(signed);
          type = signed < 0 ? "debit" : "credit";
        }
      } else {
        const debit = debitCol !== -1 ? parseMoney(fields[debitCol] ?? "") : null;
        const credit = creditCol !== -1 ? parseMoney(fields[creditCol] ?? "") : null;
        if (debit) {
          amount = Math.abs(debit);
          type = "debit";
        } else if (credit) {
          amount = Math.abs(credit);
          type = "credit";
        }
      }
    }

    if (!dateStr || !description || amount === null || amount === 0 || !type) {
      skippedRows++;
      continue;
    }
    transactions.push({ date: dateStr, description, amount, type });
  }

  return { transactions, skippedRows, warning: null };
}
