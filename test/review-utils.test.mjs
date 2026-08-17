import test from "node:test";
import assert from "node:assert/strict";
import {
  describeReviewStats, isScore, reviewScoreMatrix, reviewStats, reviewerList, scoreOptions,
} from "../js/review-utils.mjs";
import { toCsv } from "../js/csv-utils.mjs";

test("only whole numbers 1 to 10 count as a score", () => {
  for (const good of [1, 5, 10]) assert.equal(isScore(good), true, `${good}`);
  for (const bad of [0, 11, -1, 7.5, "8", null, undefined, NaN]) {
    assert.equal(isScore(bad), false, String(bad));
  }
  assert.deepEqual(scoreOptions(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("reviewStats averages the scores and rounds to one decimal", () => {
  const stats = reviewStats({
    olivia: { score: 7 }, boss: { score: 8 }, kai: { score: 7 },
  });
  assert.equal(stats.count, 3);
  assert.equal(stats.mean, 7.3);
});

test("reviewStats treats a note without a score as a review, not a zero", () => {
  const stats = reviewStats({
    olivia: { score: 9, note: "strong" },
    boss: { note: "conflict of interest, abstaining" },
  });
  assert.equal(stats.entries.length, 2, "both organizers reviewed it");
  assert.equal(stats.count, 1, "only one of them scored it");
  assert.equal(stats.mean, 9, "the abstention must not drag the mean down");
});

// Junk can only get in by hand-editing the document, but a mean is the kind of
// number people act on, so it must not quietly absorb one.
test("reviewStats drops entries with neither a valid score nor a note", () => {
  const stats = reviewStats({
    olivia: { score: 42 },
    boss: { score: "9" },
    kai: { score: null, note: "   " },
    ada: { score: 6 },
    zoe: { score: 99, note: "typo in my score, meant 9" },
  });
  assert.equal(stats.count, 1);
  assert.equal(stats.mean, 6);
  assert.deepEqual(stats.entries.map((e) => e.uid), ["ada", "zoe"],
    "a junk score with a note survives as a note; a junk score alone does not");
  assert.equal(stats.entries.find((e) => e.uid === "zoe").score, null);
});

test("reviewStats on nothing at all", () => {
  for (const empty of [undefined, null, {}]) {
    const stats = reviewStats(empty);
    assert.deepEqual(stats, { entries: [], count: 0, mean: null });
  }
});

test("describeReviewStats says something useful either way", () => {
  assert.equal(describeReviewStats(reviewStats({}), 4), "Not scored yet.");
  assert.equal(describeReviewStats(reviewStats({ a: { score: 8 } }), 4),
    "Mean 8.0 · 1 of 4 organizers scored");
  assert.equal(describeReviewStats(reviewStats({ a: { score: 8 } }), 1),
    "Mean 8.0 · 1 of 1 organizer scored");
});

test("reviewerList prefers a real name, then an email, then the uid", () => {
  const users = new Map([["olivia", { displayName: "Olivia Nero" }]]);
  assert.deepEqual(
    reviewerList([
      { id: "zed", email: "zed@ens.psl.eu" },
      { id: "olivia", email: "olivia@ens.psl.eu" },
      { id: "ghost" },
    ], users),
    [
      { uid: "ghost", name: "ghost" },
      { uid: "olivia", name: "Olivia Nero" },
      { uid: "zed", name: "zed@ens.psl.eu" },
    ]);
});

const reviewers = [{ uid: "boss", name: "Ada Boss" }, { uid: "olivia", name: "Olivia Nero" }];

const annotated = [
  {
    id: "alice", title: "Recurrent dynamics", topic: "systems",
    status: "accepted", publicType: "talk", submitterName: "Alice Dupont",
  },
  {
    id: "bob", title: "Grid cells", topic: "cognitive",
    status: "submitted", publicType: null, submitterName: "Bob Martin",
  },
];

const reviewsById = new Map([
  ["alice", { reviews: { boss: { score: 9 }, olivia: { score: 8 } } }],
  ["bob", { reviews: { boss: { score: 4 } } }],
]);

test("reviewScoreMatrix gives every organizer a column, in a fixed order", () => {
  const { columns } = reviewScoreMatrix(annotated, { reviewsById, reviewers });
  assert.deepEqual(columns.map((c) => c.label), [
    "Title", "Topic", "Status", "Presentation", "Submitted by",
    "Ada Boss", "Olivia Nero", "Mean", "Scores",
  ]);
});

test("reviewScoreMatrix leaves a reviewer's cell blank when they have not scored", () => {
  const { rows } = reviewScoreMatrix(annotated, { reviewsById, reviewers });
  assert.equal(rows[0]["r:boss"], 9);
  assert.equal(rows[0]["r:olivia"], 8);
  assert.equal(rows[0].mean, 8.5);
  assert.equal(rows[1]["r:olivia"], "", "Olivia has not scored this one");
  assert.equal(rows[1].count, 1);
});

test("an organizer who has scored nothing still gets a column", () => {
  const { columns, rows } = reviewScoreMatrix(annotated, {
    reviewsById,
    reviewers: [...reviewers, { uid: "ghost", name: "Never Reviews" }],
  });
  assert.ok(columns.some((c) => c.key === "r:ghost"));
  assert.equal(rows[0]["r:ghost"], "");
});

test("an unreviewed abstract still gets a row", () => {
  const { rows } = reviewScoreMatrix(annotated, { reviewsById: new Map(), reviewers });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].mean, "");
  assert.equal(rows[0].count, 0);
});

test("the matrix feeds toCsv unchanged", () => {
  const { columns, rows } = reviewScoreMatrix(annotated, { reviewsById, reviewers });
  const csv = toCsv(rows, columns);
  const [header, first] = csv.trim().split("\r\n");
  assert.equal(header, "Title,Topic,Status,Presentation,Submitted by,Ada Boss,Olivia Nero,Mean,Scores");
  assert.equal(first, "Recurrent dynamics,systems,accepted,talk,Alice Dupont,9,8,8.5,2");
});
