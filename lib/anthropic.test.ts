import { describe, expect, it } from "vitest";
import { extractJson } from "./anthropic";

describe("extractJson", () => {
  it("parses a plain JSON object", () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses a plain JSON array", () => {
    expect(extractJson<number[]>("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("strips prose before and after the JSON", () => {
    const text = 'Here is the result:\n{"a": 1}\nHope that helps!';
    expect(extractJson<{ a: number }>(text)).toEqual({ a: 1 });
  });

  it("strips a markdown code fence", () => {
    const text = '```json\n{"a": 1}\n```';
    expect(extractJson<{ a: number }>(text)).toEqual({ a: 1 });
  });

  it("strips an unlabeled code fence", () => {
    const text = '```\n{"a": 1}\n```';
    expect(extractJson<{ a: number }>(text)).toEqual({ a: 1 });
  });

  it("does not let a brace inside a string value throw off the depth count", () => {
    // Regression test for the bug fixed in commit a1c223f: the original
    // brace-matching loop counted `{`/`}` characters without tracking
    // whether the scan was inside a quoted string, so a stray brace in a
    // free-text field (e.g. a "notes" paragraph) could truncate or corrupt
    // the parse.
    const text = '{"notes": "the garage (see attached photo {damage}) needs work", "total": 5}';
    expect(extractJson<{ notes: string; total: number }>(text)).toEqual({
      notes: "the garage (see attached photo {damage}) needs work",
      total: 5,
    });
  });

  it("does not let a bracket inside a string value throw off the depth count", () => {
    const text = '["a[b]c", "d"]';
    expect(extractJson<string[]>(text)).toEqual(["a[b]c", "d"]);
  });

  it("handles an escaped quote inside a string value", () => {
    const text = '{"quote": "she said \\"hello\\""}';
    expect(extractJson<{ quote: string }>(text)).toEqual({ quote: 'she said "hello"' });
  });

  it("falls back to escaping raw control characters in string values", () => {
    // Claude sometimes emits a literal newline inside a string value
    // instead of escaping it as \n — invalid JSON.parse input on its own,
    // recovered by escapeControlCharsInStrings.
    const text = '{"reasoning": "line one\nline two"}';
    expect(extractJson<{ reasoning: string }>(text)).toEqual({ reasoning: "line one\nline two" });
  });

  it("stops at the matching closing brace, ignoring trailing content", () => {
    const text = '{"a": 1}{"b": 2}';
    expect(extractJson<{ a: number }>(text)).toEqual({ a: 1 });
  });

  it("throws when there is no JSON in the text", () => {
    expect(() => extractJson("no json here")).toThrow("No JSON found in model response.");
  });

  it("handles nested objects and arrays", () => {
    const text = '{"items": [{"title": "a"}, {"title": "b"}], "count": 2}';
    expect(extractJson<{ items: { title: string }[]; count: number }>(text)).toEqual({
      items: [{ title: "a" }, { title: "b" }],
      count: 2,
    });
  });
});
