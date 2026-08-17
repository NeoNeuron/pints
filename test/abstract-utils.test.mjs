import test from "node:test";
import assert from "node:assert/strict";
import {
  authorLineParts,
  draftFingerprint,
  filterAbstracts,
  filterAdminAbstracts,
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

// ------------------------------------------------------- admin console filter

const pile = [
  { id: "a", title: "Recurrent dynamics", body: "V1 recordings", topic: "systems",
    status: "accepted", publicType: "talk", talkConsidered: true,
    authors: [{ name: "Alice Dupont" }], affiliations: ["ENS"] },
  { id: "b", title: "Grid cells", body: "entorhinal", topic: "systems",
    status: "accepted", publicType: "poster", talkConsidered: false,
    authors: [{ name: "Bob Martin" }], affiliations: ["Sorbonne"] },
  { id: "c", title: "Working memory", body: "delay activity", topic: "cognitive",
    status: "submitted", publicType: null, talkConsidered: true,
    authors: [{ name: "Chloe Roy" }], affiliations: ["ENS"] },
  { id: "d", title: "Spiking networks", body: "balanced", topic: "computational",
    status: "rejected", publicType: null,
    authors: [{ name: "Dan Lee" }], affiliations: ["Inria"] },
];

const ids = (list) => list.map((a) => a.id);

test("filterAdminAbstracts with nothing set returns everything", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile, {})), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile)), ["a", "b", "c", "d"]);
  assert.deepEqual(filterAdminAbstracts(undefined), []);
});

test("filterAdminAbstracts narrows by presentation type", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile, { type: "talk" })), ["a"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile, { type: "poster" })), ["b"]);
});

// "Not published yet" is the question the committee actually asks, so it is a
// choice rather than the absence of one.
test("filterAdminAbstracts can single out what has not been published", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile, { type: "unpublished" })), ["c", "d"]);
});

test("filterAdminAbstracts narrows by status and by topic", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile, { status: "accepted" })), ["a", "b"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile, { topic: "cognitive" })), ["c"]);
});

test("filterAdminAbstracts combines every filter with the free-text search", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile,
    { status: "accepted", topic: "systems", type: "poster" })), ["b"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile, { q: "dupont" })), ["a"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile, { q: "ens", type: "unpublished" })), ["c"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile,
    { status: "accepted", q: "nothing matches this" })), []);
});

test("filterAdminAbstracts narrows by the submitter's talk opt-out", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile, { talk: "optedout" })), ["b"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile, { talk: "considered" })), ["a", "c", "d"]);
});

// An abstract with no talkConsidered field at all was submitted before the
// question was asked. Counting that as a refusal would hide it from the very
// shortlist it belongs on.
test("a missing talk opt-out counts as willing, not as a refusal", () => {
  const legacy = [{ id: "old", title: "Legacy", authors: [], affiliations: [] }];
  assert.deepEqual(ids(filterAdminAbstracts(legacy, { talk: "considered" })), ["old"]);
  assert.deepEqual(ids(filterAdminAbstracts(legacy, { talk: "optedout" })), []);
});

test("the talk filter combines with the others", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile,
    { talk: "considered", status: "accepted" })), ["a"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile,
    { talk: "optedout", type: "talk" })), [],
  "somebody who opted out and was promoted anyway would show up here");
});
