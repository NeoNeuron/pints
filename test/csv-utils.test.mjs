import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "../js/csv-utils.mjs";

test("csvCell passes plain values through", () => {
  assert.equal(csvCell("Alice"), "Alice");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csvCell quotes commas, quotes, and newlines", () => {
  assert.equal(csvCell("Dupont, Alice"), '"Dupont, Alice"');
  assert.equal(csvCell('She said "hi"'), '"She said ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
});

test("csvCell neutralises spreadsheet formula injection", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+SUM(A1)"), "'+SUM(A1)");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@import"), "'@import");
});

test("csvCell quotes AND escapes a hostile value", () => {
  assert.equal(csvCell('=cmd|"/c calc"'), `"'=cmd|""/c calc"""`);
});

test("toCsv writes a header row and CRLF line endings", () => {
  const csv = toCsv(
    [{ name: "Alice", email: "a@x.org" }, { name: "Bob", email: "b@x.org" }],
    [{ key: "name", label: "Name" }, { key: "email", label: "Email" }],
  );
  assert.equal(csv, "Name,Email\r\nAlice,a@x.org\r\nBob,b@x.org\r\n");
});

test("toCsv emits just the header for an empty list", () => {
  assert.equal(toCsv([], [{ key: "name", label: "Name" }]), "Name\r\n");
});

test("toCsv renders missing fields as empty cells", () => {
  assert.equal(
    toCsv([{ name: "Alice" }], [{ key: "name", label: "Name" }, { key: "email", label: "Email" }]),
    "Name,Email\r\nAlice,\r\n",
  );
});
