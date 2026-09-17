import { describe, expect, it } from "vitest";

import { columnsOf, exportFileName, toCsv, toJson } from "./exportRecords";

const RECORDS = [
  {
    attributes: { type: "Account", url: "/services/data/v67.0/sobjects/A" },
    Id: "001",
    Name: "Acme, Inc.",
    Owner: { attributes: { type: "User" }, Name: "Ada" },
  },
  {
    attributes: { type: "Account" },
    Id: "002",
    Name: 'He said "hello"',
    Owner: null,
    Type: "Customer",
  },
];

describe("columnsOf", () => {
  it("keeps the order fields first appear, and drops the envelope", () => {
    expect(columnsOf(RECORDS)).toEqual(["Id", "Name", "Owner", "Type"]);
    expect(columnsOf([])).toEqual([]);
  });
});

describe("toCsv", () => {
  it("quotes what needs quoting and flattens a related record", () => {
    const csv = toCsv(RECORDS);
    const [header, first, second] = csv.split("\r\n");

    expect(header).toBe("Id,Name,Owner,Type");
    expect(first).toBe('001,"Acme, Inc.","{""Name"":""Ada""}",');
    // A doubled quote, per RFC 4180 — not a backslash escape.
    expect(second).toBe('002,"He said ""hello""",,Customer');
  });

  it("is empty for no records rather than a lone header", () => {
    expect(toCsv([])).toBe("");
  });
});

describe("toJson", () => {
  it("drops the envelope but keeps everything else", () => {
    const parsed = JSON.parse(toJson(RECORDS));
    expect(parsed[0]).toEqual({
      Id: "001",
      Name: "Acme, Inc.",
      Owner: { attributes: { type: "User" }, Name: "Ada" },
    });
    expect(parsed[1].Type).toBe("Customer");
  });
});

describe("exportFileName", () => {
  it("names the file after the object and today", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(exportFileName("Account", "csv")).toBe(`Account-${today}.csv`);
    expect(exportFileName(null, "json")).toBe(`query-${today}.json`);
    // Nothing that could escape the name it was given.
    expect(exportFileName("../../etc/passwd", "csv")).toBe(
      `etcpasswd-${today}.csv`,
    );
  });
});
