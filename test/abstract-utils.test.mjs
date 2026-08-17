import test from "node:test";
import assert from "node:assert/strict";
import {
  authorLineParts,
  draftFingerprint,
  filterAbstracts,
  groupByTopic,
  nextPosterNumber,
  sortPublicAbstracts,
} from "../js/abstract-utils.mjs";

test("authorLineParts renders 1-based affiliation marks", () => {
  assert.deepEqual(
    authorLineParts([
      { name: " Alice Dupont ", affiliationIndexes: [0], presenting: true },
      { name: "Bob Martin", affiliationIndexes: [0, 1], presenting: false },
      { name: "Cleo Ba", affiliationIndexes: [], presenting: false },
    ]),
    [
      { name: "Alice Dupont", marks: "1", presenting: true },
      { name: "Bob Martin", marks: "1,2", presenting: false },
      { name: "Cleo Ba", marks: "", presenting: false },
    ],
  );
});

test("authorLineParts tolerates missing input", () => {
  assert.deepEqual(authorLineParts(undefined), []);
  assert.deepEqual(authorLineParts([{}]), [{ name: "", marks: "", presenting: false }]);
});

test("nextPosterNumber starts at 1 and fills after the highest", () => {
  assert.equal(nextPosterNumber([]), 1);
  assert.equal(nextPosterNumber(undefined), 1);
  assert.equal(nextPosterNumber([{ posterNumber: 1 }, { posterNumber: 4 }]), 5);
  assert.equal(nextPosterNumber([{ posterNumber: null }, { posterNumber: 2 }]), 3);
});

test("filterAbstracts matches title, author names, affiliations, and body", () => {
  const list = [
    {
      title: "Recurrent dynamics", body: "V1 recordings",
      authors: [{ name: "Alice Dupont" }], affiliations: ["ENS"],
    },
    {
      title: "Dendritic computation", body: "modelling",
      authors: [{ name: "Bob Martin" }], affiliations: ["Sorbonne"],
    },
  ];
  assert.equal(filterAbstracts(list, "recurrent").length, 1);
  assert.equal(filterAbstracts(list, "DUPONT").length, 1);
  assert.equal(filterAbstracts(list, "modelling").length, 1);
  assert.equal(filterAbstracts(list, "sorbonne").length, 1);
  assert.equal(filterAbstracts(list, "").length, 2);
  assert.equal(filterAbstracts(list, "   ").length, 2);
  assert.equal(filterAbstracts(list, "nothing here").length, 0);
});

test("filterAbstracts does not mutate its input", () => {
  const list = [{ title: "A" }, { title: "B" }];
  filterAbstracts(list, "");
  assert.equal(list.length, 2);
});

test("sortPublicAbstracts puts talks before posters, then orders by poster number", () => {
  const sorted = sortPublicAbstracts([
    { type: "poster", posterNumber: 2, title: "B" },
    { type: "talk", posterNumber: null, title: "Z" },
    { type: "poster", posterNumber: 1, title: "A" },
    { type: "talk", posterNumber: null, title: "A" },
  ]);
  assert.deepEqual(
    sorted.map((a) => `${a.type}:${a.title}`),
    ["talk:A", "talk:Z", "poster:A", "poster:B"],
  );
});

test("sortPublicAbstracts does not mutate its input", () => {
  const input = [{ type: "poster", posterNumber: 2 }, { type: "talk" }];
  sortPublicAbstracts(input);
  assert.deepEqual(input.map((a) => a.type), ["poster", "talk"]);
});

test("groupByTopic orders groups as config declares them", () => {
  const groups = groupByTopic(
    [{ topic: "systems" }, { topic: "cognitive" }, { topic: "computational" }],
    ["cognitive", "systems", "computational"],
  );
  assert.deepEqual(groups.map((g) => g.topic), ["cognitive", "systems", "computational"]);
});

test("groupByTopic drops empty topics but keeps every abstract", () => {
  const groups = groupByTopic(
    [{ id: 1, topic: "systems" }, { id: 2, topic: "systems" }],
    ["cognitive", "systems", "computational"],
  );
  assert.deepEqual(groups.map((g) => g.topic), ["systems"]);
  assert.deepEqual(groups[0].items.map((a) => a.id), [1, 2]);
});

// An abstract the reviewers cannot see is worse than an untidy heading.
test("groupByTopic sweeps missing and unknown topics into a final bucket", () => {
  const groups = groupByTopic(
    [{ id: 1, topic: "systems" }, { id: 2 }, { id: 3, topic: "phrenology" }],
    ["cognitive", "systems", "computational"],
  );
  assert.equal(groups.at(-1).topic, null);
  assert.deepEqual(groups.at(-1).items.map((a) => a.id), [2, 3]);
});

test("groupByTopic handles an empty list and a nullish list", () => {
  assert.deepEqual(groupByTopic([], ["cognitive"]), []);
  assert.deepEqual(groupByTopic(undefined, ["cognitive"]), []);
});

// --------------------------------------------------------- draftFingerprint

const draft = () => ({
  title: "Grid cells in the dark",
  topic: "systems",
  affiliations: ["École normale supérieure", "Collège de France"],
  authors: [
    { name: "Kai Chen", affiliationIndexes: [0], presenting: true },
    { name: "A Colleague", affiliationIndexes: [0, 1], presenting: false },
  ],
  body: "We recorded from medial entorhinal cortex in darkness.",
  talkConsidered: true,
});

test("draftFingerprint matches for an unchanged draft rebuilt from the DOM", () => {
  assert.equal(draftFingerprint(draft()), draftFingerprint(draft()));
});

test("draftFingerprint ignores key order", () => {
  const a = draft();
  const b = {
    talkConsidered: true,
    body: a.body,
    authors: a.authors,
    affiliations: a.affiliations,
    topic: a.topic,
    title: a.title,
  };
  assert.equal(draftFingerprint(a), draftFingerprint(b));
});

// Whitespace the parsers already trim must not read as an unsaved change, or
// every editor would prompt on open.
test("draftFingerprint ignores whitespace the parsers strip", () => {
  const padded = draft();
  padded.title = "  Grid cells in the dark  ";
  padded.affiliations = padded.affiliations.map((a) => `  ${a} `);
  padded.authors = padded.authors.map((x) => ({ ...x, name: ` ${x.name}` }));
  assert.equal(draftFingerprint(padded), draftFingerprint(draft()));
});

test("draftFingerprint changes on every editable field", () => {
  const base = draftFingerprint(draft());
  const changed = [
    { ...draft(), title: "Grid cells in the light" },
    { ...draft(), topic: "computational" },
    { ...draft(), affiliations: [...draft().affiliations, "Sorbonne"] },
    { ...draft(), authors: [...draft().authors].reverse() },
    { ...draft(), body: `${draft().body} Then we did it again.` },
    { ...draft(), talkConsidered: false },
  ];
  for (const d of changed) assert.notEqual(draftFingerprint(d), base);
});

test("draftFingerprint distinguishes affiliation marks and the presenting author", () => {
  const base = draftFingerprint(draft());
  const remarked = draft();
  remarked.authors[0].affiliationIndexes = [0, 1];
  assert.notEqual(draftFingerprint(remarked), base);

  const represented = draft();
  represented.authors[0].presenting = false;
  represented.authors[1].presenting = true;
  assert.notEqual(draftFingerprint(represented), base);
});

test("draftFingerprint tolerates an empty draft", () => {
  assert.equal(draftFingerprint({}), draftFingerprint({ authors: [], affiliations: [] }));
});
