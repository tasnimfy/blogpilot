import { describe, it, expect } from "vitest";
import { parseCsv, looksLikeHeader, parseNumber, parseInteger, parseFloatCell, stripBom } from "@/lib/csv";

describe("CSV parser", () => {
  it("parses simple rows", () => {
    const { header, rows } = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
    expect(header).toEqual(["a", "b", "c"]);
    expect(rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles quoted fields with commas and quotes", () => {
    const csv = 'name,desc\n"rafting, best","he said ""hi"""\n';
    const { header, rows } = parseCsv(csv);
    expect(header).toEqual(["name", "desc"]);
    expect(rows[0][0]).toBe("rafting, best");
    expect(rows[0][1]).toBe('he said "hi"');
  });

  it("handles quoted fields spanning newlines", () => {
    const csv = "a,b\n\"line1\nline2\",x\n";
    const { rows } = parseCsv(csv);
    expect(rows[0][0]).toBe("line1\nline2");
    expect(rows[0][1]).toBe("x");
  });

  it("handles CRLF and BOM", () => {
    const csv = "\uFEFFa,b\r\n1,2\r\n3,4\r\n";
    const { header, rows } = parseCsv(csv);
    expect(header).toEqual(["a", "b"]);
    expect(rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops empty trailing rows but keeps empty inner fields", () => {
    const csv = "a,b\n1,\n\n\n";
    const { header, rows } = parseCsv(csv);
    expect(header).toEqual(["a", "b"]);
    expect(rows).toEqual([["1", ""]]);
  });

  it("returns null header for empty input", () => {
    expect(parseCsv("").header).toBeNull();
  });

  it("detects header rows", () => {
    expect(looksLikeHeader(["Keyword", "Search Volume", "CPC"])).toBe(true);
    expect(looksLikeHeader(["rafting trips", "12", "1.5"])).toBe(false);
  });

  it("stripBom removes BOM", () => {
    expect(stripBom("\uFEFFhello")).toBe("hello");
  });

  it("parses numbers without inventing zero", () => {
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber("$5.50")).toBe(5.5);
    expect(parseNumber("10%")).toBe(10);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
    expect(parseInteger("42")).toBe(42);
    expect(parseInteger("abc")).toBeNull();
    expect(parseInteger("")).toBeNull();
    expect(parseFloatCell("2.5")).toBe(2.5);
  });
});
