import test from "node:test";
import assert from "node:assert/strict";
import {
  ABSTRACT_EXPORT_COLUMNS, abstractExportRows, annotateAbstracts, authorsCell,
  isoDate, presentingAuthor,
} from "../js/abstract-export-utils.mjs";
import { toCsv } from "../js/csv-utils.mjs";

const abstract = (over = {}) => ({
  id: "alice",
  ownerUid: "alice",
  title: "Recurrent dynamics",
  topic: "systems",
  status: "accepted",
  affiliations: ["ENS", "Sorbonne"],
  authors: [
    { name: "Alice Dupont", affiliationIndexes: [0], presenting: true },
    { name: "Bob Martin", affiliationIndexes: [0, 1], presenting: false },
  ],
  body: "We recorded from V1.",
  talkConsidered: true,
  figureUrl: "https://example.org/f.png",
  figureCaption: "Tuning curves.",
  createdAt: new Date("2026-09-04T10:00:00Z"),
  updatedAt: new Date("2026-09-09T08:30:00Z"),
  ...over,
});

test("isoDate accepts a Date, a Firestore Timestamp, or nothing", () => {
  assert.equal(isoDate(new Date("2026-11-06T12:00:00Z")), "2026-11-06");
  assert.equal(isoDate({ toDate: () => new Date("2026-11-06T12:00:00Z") }), "2026-11-06");
  assert.equal(isoDate(null), "");
  assert.equal(isoDate(undefined), "");
  assert.equal(isoDate("not a date"), "");
  assert.equal(isoDate(new Date("nonsense")), "");
});

test("annotateAbstracts joins the published copy and the submitter", () => {
  const [row] = annotateAbstracts([abstract()], {
    published: [{ id: "alice", type: "poster", posterNumber: 7 }],
    users: [{ id: "alice", displayName: "Alice Dupont", email: "alice@ens.psl.eu" }],
  });
  assert.equal(row.publicType, "poster");
  assert.equal(row.posterNumber, 7);
  assert.equal(row.submitterName, "Alice Dupont");
  assert.equal(row.submitterEmail, "alice@ens.psl.eu");
  assert.equal(row.title, "Recurrent dynamics", "the original fields survive");
});

test("annotateAbstracts leaves an unpublished abstract with no type", () => {
  const [row] = annotateAbstracts([abstract({ status: "submitted" })], {});
  assert.equal(row.publicType, null);
  assert.equal(row.posterNumber, null);
  assert.equal(row.submitterName, "");
});

test("authorsCell writes affiliation marks the way a reader expects", () => {
  assert.equal(authorsCell(abstract().authors),
    "Alice Dupont (1); Bob Martin (1,2)");
  assert.equal(authorsCell([{ name: "Solo" }]), "Solo");
  assert.equal(authorsCell([]), "");
  assert.equal(authorsCell(undefined), "");
});

test("presentingAuthor picks the marked author, or nobody", () => {
  assert.equal(presentingAuthor(abstract().authors), "Alice Dupont");
  assert.equal(presentingAuthor([{ name: "Nobody", presenting: false }]), "");
});

test("abstractExportRows fills every declared column", () => {
  const annotated = annotateAbstracts([abstract()], {
    published: [{ id: "alice", type: "poster", posterNumber: 7 }],
    users: [{ id: "alice", displayName: "Alice Dupont", email: "alice@ens.psl.eu" }],
  });
  const [row] = abstractExportRows(annotated);
  for (const column of ABSTRACT_EXPORT_COLUMNS) {
    assert.ok(column.key in row, `missing column ${column.key}`);
  }
  assert.equal(row.topic, "Systems", "the topic is the label, not the slug");
  assert.equal(row.posterNumber, 7);
  assert.equal(row.talkConsidered, "yes");
  assert.equal(row.affiliations, "1. ENS; 2. Sorbonne");
  assert.equal(row.createdAt, "2026-09-04");
});

test("an undecided abstract exports a blank presentation, not a poster", () => {
  const annotated = annotateAbstracts([abstract({ status: "submitted" })], {});
  const [row] = abstractExportRows(annotated);
  assert.equal(row.type, "");
  assert.equal(row.posterNumber, "");
});

test("a talk exports no poster number even if one was once assigned", () => {
  const annotated = annotateAbstracts([abstract()], {
    published: [{ id: "alice", type: "talk", posterNumber: 7 }],
  });
  assert.equal(abstractExportRows(annotated)[0].posterNumber, "");
});

test("the talk opt-out survives into the export", () => {
  const annotated = annotateAbstracts([abstract({ talkConsidered: false })], {});
  assert.equal(abstractExportRows(annotated)[0].talkConsidered, "no");
});

// The reason csv-utils exists. A title is participant input, and a spreadsheet
// treats a leading "=" as a formula.
test("a hostile title survives as text through the CSV", () => {
  const annotated = annotateAbstracts([abstract({ title: '=cmd|\'/c calc\'!A1' })], {});
  const csv = toCsv(abstractExportRows(annotated), ABSTRACT_EXPORT_COLUMNS);
  assert.ok(csv.includes("'=cmd"), "the formula must be defused with a leading apostrophe");
});

test("exporting nothing yields a header and no rows", () => {
  const csv = toCsv(abstractExportRows([]), ABSTRACT_EXPORT_COLUMNS);
  assert.equal(csv.trim().split("\r\n").length, 1);
});
