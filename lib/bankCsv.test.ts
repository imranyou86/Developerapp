import { describe, expect, it } from "vitest";
import { parseBankCsv } from "./bankCsv";

describe("parseBankCsv", () => {
  it("parses a Chase-style CSV (single signed Amount column)", () => {
    const csv = ["Date,Description,Amount", "01/15/2026,ACME Framing Inc,-4500.00", "01/20/2026,Loan Draw Deposit,10000.00"].join("\n");
    const result = parseBankCsv(csv);
    expect(result.warning).toBeNull();
    expect(result.skippedRows).toBe(0);
    expect(result.transactions).toEqual([
      { date: "2026-01-15", description: "ACME Framing Inc", amount: 4500, type: "debit" },
      { date: "2026-01-20", description: "Loan Draw Deposit", amount: 10000, type: "credit" },
    ]);
  });

  it("parses a Bank of America-style CSV (separate Debit/Credit columns, extra Running Bal. column)", () => {
    const csv = [
      "Date,Description,Debit,Credit,Running Bal.",
      "02/01/2026,Smith Plumbing,1200.00,,50000.00",
      "02/03/2026,Owner Deposit,,5000.00,55000.00",
    ].join("\n");
    const result = parseBankCsv(csv);
    expect(result.transactions).toEqual([
      { date: "2026-02-01", description: "Smith Plumbing", amount: 1200, type: "debit" },
      { date: "2026-02-03", description: "Owner Deposit", amount: 5000, type: "credit" },
    ]);
  });

  it("parses a headerless Wells Fargo-style CSV (Date, Amount, *, *, Description)", () => {
    const csv = ['3/1/2026,-750.00,*,*,"Rodriguez Electric, Inc."', "3/2/2026,2000.00,*,*,Transfer from savings"].join("\n");
    const result = parseBankCsv(csv);
    expect(result.transactions).toEqual([
      { date: "2026-03-01", description: "Rodriguez Electric, Inc.", amount: 750, type: "debit" },
      { date: "2026-03-02", description: "Transfer from savings", amount: 2000, type: "credit" },
    ]);
  });

  it("prefers a Description column over a Detail/Details column when both are present", () => {
    const csv = [
      "Date,Detail,Description,Amount",
      "01/05/2026,DEBIT,ACME Framing Inc,-1500.00",
      "01/06/2026,CREDIT,Loan Draw Deposit,2000.00",
    ].join("\n");
    const result = parseBankCsv(csv);
    expect(result.transactions).toEqual([
      { date: "2026-01-05", description: "ACME Framing Inc", amount: 1500, type: "debit" },
      { date: "2026-01-06", description: "Loan Draw Deposit", amount: 2000, type: "credit" },
    ]);
  });

  it("handles quoted descriptions containing commas", () => {
    const csv = ['Date,Description,Amount', '01/01/2026,"Doe, John - Concrete Co.",-300.00'].join("\n");
    const result = parseBankCsv(csv);
    expect(result.transactions).toEqual([{ date: "2026-01-01", description: "Doe, John - Concrete Co.", amount: 300, type: "debit" }]);
  });

  it("skips rows with a missing date, description, or amount and counts them", () => {
    const csv = ["Date,Description,Amount", "01/01/2026,Valid Row,-100.00", ",Missing date,-50.00", "01/02/2026,Missing amount,"].join("\n");
    const result = parseBankCsv(csv);
    expect(result.transactions).toHaveLength(1);
    expect(result.skippedRows).toBe(2);
  });

  it("returns a warning for unrecognizable column layouts", () => {
    const csv = ["Foo,Bar,Baz", "1,2,3"].join("\n");
    const result = parseBankCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.warning).toMatch(/couldn't recognize/i);
  });

  it("returns an empty-file warning for a blank input", () => {
    const result = parseBankCsv("   \n  \n");
    expect(result.transactions).toEqual([]);
    expect(result.warning).toMatch(/empty/i);
  });
});
