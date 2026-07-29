import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc,
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
  type: "poster",
  status: "submitted",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

test("a verified owner can submit while the window is open", async () => {
  await seedConfig(env);
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});

test("an unverified user cannot submit", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice", { verified: false });
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract()));
});

test("an anonymous visitor cannot submit", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asAnon(env), "abstracts", "alice"), abstract()));
});

test("nobody can submit once submissions are toggled closed", async () => {
  await seedConfig(env, { open: false });
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});

test("nobody can submit once the deadline has passed, even if the toggle was forgotten", async () => {
  await seedConfig(env, { open: true, deadline: PAST });
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});

test("a user cannot submit under another user's document id", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "bob"),
    abstract({ ownerUid: "bob" })));
});

test("a user cannot self-accept", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ status: "accepted" })));
});

test("oversized fields, unknown keys, and bad types are rejected", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ title: "x".repeat(201) })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ body: "y".repeat(2501) })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ posterNumber: 3 })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ type: "keynote" })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ authors: [] })));
});

test("an owner can edit their abstract while it is still submitted", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ title: "A better title" })));
});

test("an owner CANNOT edit or delete once accepted", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "accepted" })));
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "abstracts", "alice"),
    abstract({ status: "accepted", title: "Sneaky" })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"),
    abstract({ status: "submitted", title: "Sneaky" })));
  await assertFails(deleteDoc(doc(fs, "abstracts", "alice")));
});

// Only `accepted` may be frozen. Freezing every non-submitted status would trap
// a rejected participant with a document they can neither revise, delete, nor
// replace — the doc id is their uid, so there is no second slot.
test("an owner can revise and resubmit after a rejection", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "rejected" })));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ status: "submitted", title: "Revised after review" })));
});

test("an owner can resubmit after an admin withdrawal", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "withdrawn" })));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ status: "submitted", title: "Back again" })));
});

test("an owner can delete a rejected abstract to start over", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "rejected" })));
  await assertSucceeds(deleteDoc(doc(asUser(env, "alice"), "abstracts", "alice")));
});

test("an owner can withdraw while still submitted", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertSucceeds(deleteDoc(doc(asUser(env, "alice"), "abstracts", "alice")));
});

test("an owner reads only their own abstract; anonymous reads none", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "bob"), abstract({ ownerUid: "bob" })));
  await assertFails(getDoc(doc(asUser(env, "alice"), "abstracts", "bob")));
  await assertFails(getDoc(doc(asAnon(env), "abstracts", "bob")));
});

test("only an admin can list all abstracts", async () => {
  await seedAdmin(env, "boss");
  await assertFails(getDocs(collection(asUser(env, "alice"), "abstracts")));
  await assertFails(getDocs(collection(asAnon(env), "abstracts")));
  await assertSucceeds(getDocs(collection(asUser(env, "boss"), "abstracts")));
});

test("an admin can change status after the deadline", async () => {
  await seedConfig(env, { open: true, deadline: PAST });
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertSucceeds(updateDoc(doc(asUser(env, "boss"), "abstracts", "alice"),
    { status: "accepted" }));
});

test("review notes are admin-only, even for the abstract's owner", async () => {
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "abstract_reviews", "alice"), { note: "weak methods" }));
  await assertFails(getDoc(doc(asUser(env, "alice"), "abstract_reviews", "alice")));
  await assertFails(getDoc(doc(asAnon(env), "abstract_reviews", "alice")));
  await assertSucceeds(getDoc(doc(asUser(env, "boss"), "abstract_reviews", "alice")));
});

test("published abstracts are world-readable but admin-write only", async () => {
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "abstracts_public", "alice"),
    { title: "T", posterNumber: 1, edition: "pints2026" }));
  await assertSucceeds(getDocs(collection(asAnon(env), "abstracts_public")));
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts_public", "alice"),
    { title: "Mine now" }));
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "abstracts_public", "alice"),
    { title: "T2", edition: "pints2026" }));
});

test("a missing config/site denies submission rather than allowing it", async () => {
  // No seedConfig here on purpose: get() on a missing document makes the rule
  // error, and an erroring rule must fail closed.
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});
