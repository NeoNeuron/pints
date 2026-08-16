import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin, seedConfig } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const PAST = new Date(Date.now() - 864e5);

const abstract = (over = {}) => ({
  ownerUid: "alice",
  edition: "pints2026",
  title: "Recurrent dynamics in mouse V1",
  affiliations: ["ENS"],
  authors: [{ name: "Alice Dupont", affiliationIndexes: [0], presenting: true }],
  body: "We recorded from V1.",
  topic: "systems",
  talkConsidered: true,
  figureUrl: null,
  figurePath: null,
  status: "submitted",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

test("a verified owner can submit while the window is open", async () => {
  await seedConfig(env);
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"), abstract()));
});

test("one participant can submit several abstracts", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice");
  await assertSucceeds(setDoc(doc(fs, "abstracts", "a1"), abstract({ title: "First" })));
  await assertSucceeds(setDoc(doc(fs, "abstracts", "a2"), abstract({ title: "Second" })));
  await assertSucceeds(setDoc(doc(fs, "abstracts", "a3"), abstract({ title: "Third" })));
});

test("an unverified user cannot submit", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice", { verified: false });
  await assertFails(setDoc(doc(fs, "abstracts", "a1"), abstract()));
});

test("an anonymous visitor cannot submit", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asAnon(env), "abstracts", "a1"), abstract()));
});

test("nobody can submit once submissions are toggled closed", async () => {
  await seedConfig(env, { open: false });
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"), abstract()));
});

test("nobody can submit once the deadline has passed, even if the toggle was forgotten", async () => {
  await seedConfig(env, { open: true, deadline: PAST });
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"), abstract()));
});

test("a user cannot submit an abstract owned by someone else", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"),
    abstract({ ownerUid: "bob" })));
});

test("a user cannot self-accept", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"),
    abstract({ status: "accepted" })));
});

test("oversized fields, unknown keys, and bad types are rejected", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice");
  const bad = (over) => assertFails(setDoc(doc(fs, "abstracts", "a1"), abstract(over)));
  await bad({ title: "x".repeat(201) });
  await bad({ body: "y".repeat(2501) });
  await bad({ posterNumber: 3 });
  await bad({ authors: [] });
  await bad({ figureUrl: "u".repeat(501) });
  await bad({ talkConsidered: "no" });
});

test("the topic must be one of the three the site offers", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "abstracts", "a1"), abstract({ topic: "quantum" })));
  for (const topic of ["cognitive", "systems", "computational"]) {
    await assertSucceeds(setDoc(doc(fs, "abstracts", `a-${topic}`), abstract({ topic })));
  }
});

test("the submitter cannot set a presentation type — that is the committee's call", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"),
    abstract({ type: "talk" })));
});

test("a figure url and path are optional but must be strings when present", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice");
  await assertSucceeds(setDoc(doc(fs, "abstracts", "a1"), abstract({
    figureUrl: "https://example.org/f.png", figurePath: "abstract_figures/alice/a1",
  })));
  await assertFails(setDoc(doc(fs, "abstracts", "a2"), abstract({ figureUrl: 42 })));
});

test("an owner can edit their abstract while it is still submitted", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "a1"), abstract()));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"),
    abstract({ title: "A better title" })));
});

test("ownerUid cannot be reassigned on update", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "a1"), abstract()));
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"),
    abstract({ ownerUid: "bob" })));
});

test("an owner CANNOT edit or delete once accepted", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "a1"), abstract({ status: "accepted" })));
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "abstracts", "a1"),
    abstract({ status: "accepted", title: "Sneaky" })));
  await assertFails(setDoc(doc(fs, "abstracts", "a1"),
    abstract({ status: "submitted", title: "Sneaky" })));
  await assertFails(deleteDoc(doc(fs, "abstracts", "a1")));
});

// Only `accepted` is frozen. A rejected submission must stay editable so the
// participant can revise it before the deadline.
test("an owner can revise and resubmit after a rejection", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "a1"), abstract({ status: "rejected" })));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"),
    abstract({ status: "submitted", title: "Revised after review" })));
});

test("an owner can resubmit after an admin withdrawal", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "a1"), abstract({ status: "withdrawn" })));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"),
    abstract({ status: "submitted", title: "Back again" })));
});

test("an owner can delete any abstract that has not been accepted", async () => {
  await seedConfig(env);
  await seed(env, async (fs) => {
    await setDoc(doc(fs, "abstracts", "a1"), abstract({ status: "rejected" }));
    await setDoc(doc(fs, "abstracts", "a2"), abstract());
  });
  const fs = asUser(env, "alice");
  await assertSucceeds(deleteDoc(doc(fs, "abstracts", "a1")));
  await assertSucceeds(deleteDoc(doc(fs, "abstracts", "a2")));
});

test("a user cannot read, edit, or delete somebody else's abstract", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "b1"), abstract({ ownerUid: "bob" })));
  const fs = asUser(env, "alice");
  await assertFails(getDoc(doc(fs, "abstracts", "b1")));
  await assertFails(getDoc(doc(asAnon(env), "abstracts", "b1")));
  await assertFails(setDoc(doc(fs, "abstracts", "b1"), abstract({ ownerUid: "bob" })));
  await assertFails(deleteDoc(doc(fs, "abstracts", "b1")));
});

// This is the load-bearing one. `list` is evaluated per candidate document, so
// a query that does not filter on ownerUid sweeps in other people's rows and
// must be denied outright — it is the only thing keeping the submission pile
// private from any signed-in user.
test("an owner lists their own abstracts only by filtering on ownerUid", async () => {
  await seed(env, async (fs) => {
    await setDoc(doc(fs, "abstracts", "a1"), abstract({ title: "Mine 1" }));
    await setDoc(doc(fs, "abstracts", "a2"), abstract({ title: "Mine 2" }));
    await setDoc(doc(fs, "abstracts", "b1"), abstract({ ownerUid: "bob" }));
  });
  const fs = asUser(env, "alice");
  const mine = query(collection(fs, "abstracts"), where("ownerUid", "==", "alice"));
  const snap = await assertSucceeds(getDocs(mine));
  if (snap.size !== 2) throw new Error(`expected 2 abstracts, got ${snap.size}`);

  await assertFails(getDocs(collection(fs, "abstracts")));
  await assertFails(getDocs(query(collection(fs, "abstracts"), where("ownerUid", "==", "bob"))));
});

test("only an admin can list every abstract unfiltered", async () => {
  await seedAdmin(env, "boss");
  await assertFails(getDocs(collection(asAnon(env), "abstracts")));
  await assertSucceeds(getDocs(collection(asUser(env, "boss"), "abstracts")));
});

test("an admin can change status after the deadline", async () => {
  await seedConfig(env, { open: true, deadline: PAST });
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "a1"), abstract()));
  await assertSucceeds(updateDoc(doc(asUser(env, "boss"), "abstracts", "a1"),
    { status: "accepted" }));
});

test("review notes are admin-only, even for the abstract's owner", async () => {
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "abstract_reviews", "a1"), { note: "weak methods" }));
  await assertFails(getDoc(doc(asUser(env, "alice"), "abstract_reviews", "a1")));
  await assertFails(getDoc(doc(asAnon(env), "abstract_reviews", "a1")));
  await assertSucceeds(getDoc(doc(asUser(env, "boss"), "abstract_reviews", "a1")));
});

test("published abstracts are world-readable but admin-write only", async () => {
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "abstracts_public", "a1"),
    { title: "T", type: "poster", posterNumber: 1, edition: "pints2026" }));
  await assertSucceeds(getDocs(collection(asAnon(env), "abstracts_public")));
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts_public", "a1"),
    { title: "Mine now" }));
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "abstracts_public", "a1"),
    { title: "T2", type: "talk", edition: "pints2026" }));
});

test("a missing config/site denies submission rather than allowing it", async () => {
  // No seedConfig here on purpose: get() on a missing document makes the rule
  // error, and an erroring rule must fail closed.
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "a1"), abstract()));
});
