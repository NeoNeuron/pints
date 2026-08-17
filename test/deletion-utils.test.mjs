import test from "node:test";
import assert from "node:assert/strict";
import {
  abstractDeletionPlan,
  describeAbstractDeletion,
  describeParticipantDeletion,
  participantDeletionPlan,
} from "../js/deletion-utils.mjs";

const abstracts = [
  { id: "a1", ownerUid: "alice", figurePath: "abstract_figures/alice/a1" },
  { id: "a2", ownerUid: "alice", figurePath: null },
  { id: "a3", ownerUid: "bob", figurePath: "abstract_figures/bob/a3" },
];
const published = [{ id: "a1" }, { id: "a3" }];

test("participantDeletionPlan collects only that participant's abstracts", () => {
  const plan = participantDeletionPlan("alice", abstracts, published);
  assert.deepEqual(plan.abstractIds, ["a1", "a2"]);
  assert.deepEqual(plan.publishedIds, ["a1"]);
  assert.deepEqual(plan.figurePaths, ["abstract_figures/alice/a1"]);
});

// Bob's published abstract must not be counted against Alice, or the dialog
// overstates the damage and an organizer cancels a delete they meant to do.
test("participantDeletionPlan never claims another owner's published copy", () => {
  const plan = participantDeletionPlan("alice", abstracts, published);
  assert.ok(!plan.publishedIds.includes("a3"));
});

test("participantDeletionPlan handles someone who submitted nothing", () => {
  const plan = participantDeletionPlan("carol", abstracts, published);
  assert.deepEqual(plan.abstractIds, []);
  assert.deepEqual(plan.publishedIds, []);
  assert.deepEqual(plan.figurePaths, []);
});

test("participantDeletionPlan tolerates missing lists", () => {
  const plan = participantDeletionPlan("alice");
  assert.deepEqual(plan, { uid: "alice", abstractIds: [], publishedIds: [], figurePaths: [] });
});

test("abstractDeletionPlan reports whether the abstract is published", () => {
  assert.deepEqual(abstractDeletionPlan(abstracts[0], published).publishedIds, ["a1"]);
  assert.deepEqual(abstractDeletionPlan(abstracts[1], published).publishedIds, []);
  assert.deepEqual(abstractDeletionPlan(abstracts[1], published).figurePaths, []);
});

test("describeParticipantDeletion names the abstracts, the published ones, and the login", () => {
  const text = describeParticipantDeletion("Kai Chen", participantDeletionPlan("alice", abstracts, published));
  assert.equal(text, "Delete “Kai Chen”? This also deletes their 2 abstracts, "
    + "1 of them published, and their login. It cannot be undone.");
});

// "1 abstract, 1 of them published" is the kind of sentence that makes a reader
// stop and reparse, right where they are deciding whether to destroy something.
test("describeParticipantDeletion reads naturally for a single abstract", () => {
  const text = describeParticipantDeletion("Kai Chen", participantDeletionPlan("bob", abstracts, published));
  assert.equal(text, "Delete “Kai Chen”? This also deletes their abstract, "
    + "which is published, and their login. It cannot be undone.");
});

test("describeParticipantDeletion omits the published clause when nothing is public", () => {
  const drafts = [{ id: "d1", ownerUid: "dana" }, { id: "d2", ownerUid: "dana" }];
  assert.equal(
    describeParticipantDeletion("Dana", participantDeletionPlan("dana", drafts, [])),
    "Delete “Dana”? This also deletes their 2 abstracts and their login. It cannot be undone.");
  assert.equal(
    describeParticipantDeletion("Dana", participantDeletionPlan("dana", [drafts[0]], [])),
    "Delete “Dana”? This also deletes their abstract and their login. It cannot be undone.");
});

// Somebody who registered but never submitted still loses their login, and the
// sentence has to say so rather than trailing off.
test("describeParticipantDeletion still mentions the login when nothing was submitted", () => {
  const text = describeParticipantDeletion("Carol", participantDeletionPlan("carol", abstracts, published));
  assert.equal(text, "Delete “Carol”? This also deletes their login. It cannot be undone.");
});

test("describeParticipantDeletion falls back when the name is missing", () => {
  assert.match(describeParticipantDeletion("", participantDeletionPlan("carol")), /this participant/);
  assert.match(describeParticipantDeletion("   ", participantDeletionPlan("carol")), /this participant/);
});

test("describeAbstractDeletion warns only when the abstract is published", () => {
  const pub = describeAbstractDeletion("Grid cells", abstractDeletionPlan(abstracts[0], published));
  const unpub = describeAbstractDeletion("Grid cells", abstractDeletionPlan(abstracts[1], published));
  assert.match(pub, /disappear from the public list/);
  assert.ok(!/disappear from the public list/.test(unpub));
  assert.match(unpub, /cannot be undone/);
});
