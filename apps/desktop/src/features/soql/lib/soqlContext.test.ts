import { describe, expect, it } from "vitest";

import { objectOfQuery, soqlContextAt } from "./soqlContext";

/** Puts the cursor where the `|` is and returns the context there. */
function at(withCursor: string) {
  const offset = withCursor.indexOf("|");
  return soqlContextAt(withCursor.replace("|", ""), offset);
}

describe("soqlContextAt", () => {
  it("asks for an object after FROM", () => {
    expect(at("SELECT Id FROM |")).toMatchObject({
      kind: "object",
      prefix: "",
    });
    expect(at("SELECT Id FROM Acc|")).toMatchObject({
      kind: "object",
      prefix: "Acc",
    });
  });

  it("asks for a field in the select list, knowing the object", () => {
    expect(at("SELECT | FROM Account")).toMatchObject({
      kind: "field",
      object: "Account",
      prefix: "",
    });
    expect(at("SELECT Id, Na| FROM Account")).toMatchObject({
      kind: "field",
      object: "Account",
      prefix: "Na",
    });
  });

  it("asks for a field in WHERE, ORDER BY and GROUP BY", () => {
    for (const clause of ["WHERE ", "ORDER BY ", "GROUP BY "]) {
      expect(at(`SELECT Id FROM Account ${clause}|`)).toMatchObject({
        kind: "field",
        object: "Account",
      });
    }
  });

  it("follows a relationship path", () => {
    expect(at("SELECT Account.|  FROM Contact")).toMatchObject({
      kind: "field",
      object: "Contact",
      prefix: "",
      path: ["Account"],
    });
    expect(at("SELECT Account.Owner.Na| FROM Contact")).toMatchObject({
      kind: "field",
      prefix: "Na",
      path: ["Account", "Owner"],
    });
  });

  it("suggests nothing inside a string literal", () => {
    expect(at("SELECT Id FROM Account WHERE Name = 'Acme |")).toMatchObject({
      kind: "none",
    });
    // The literal is closed again, so the next word is a field.
    expect(
      at("SELECT Id FROM Account WHERE Name = 'Acme' AND Ty|"),
    ).toMatchObject({ kind: "field", object: "Account", prefix: "Ty" });
  });

  it("suggests nothing before the query begins", () => {
    expect(at("|")).toMatchObject({ kind: "none" });
    expect(at("  |")).toMatchObject({ kind: "none" });
  });
});

describe("objectOfQuery", () => {
  it("finds the object even when the cursor is before FROM", () => {
    const query = "SELECT Id FROM Account";
    expect(objectOfQuery(query, "SELECT ".length)).toBe("Account");
    expect(objectOfQuery(query, query.length)).toBe("Account");
  });

  it("uses the nearest FROM before the cursor, for a sub-query", () => {
    const query = "SELECT Id, (SELECT Id FROM Contacts) FROM Account";
    // Inside the sub-query — just after "Contacts", before the closing
    // paren — the nearest FROM before the cursor is the sub-query's.
    const insideSubQuery = query.indexOf("Contacts") + "Contacts".length;
    expect(objectOfQuery(query, insideSubQuery)).toBe("Contacts");
    // Past it, the outer FROM is the nearest one again.
    expect(objectOfQuery(query, query.length)).toBe("Account");
  });

  it("is null when nothing has been selected from yet", () => {
    expect(objectOfQuery("SELECT Id", 9)).toBeNull();
  });
});
