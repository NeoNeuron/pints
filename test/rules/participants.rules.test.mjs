import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const pub = (over = {}) => ({
  displayName: "Alice Dupont",
  affiliation: "ENS",
  edition: "pints2026",
  updatedAt: new Date(),
  ...over,
});

test("anyone can list public participants", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "alice"), pub()));
  await assertSucceeds(getDocs(collection(asAnon(env), "participants_public")));
});

test("a user can publish their own name", async () => {
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"), pub()));
});

test("a user cannot publish someone else's name", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "participants_public", "bob"), pub()));
});

test("an anonymous visitor cannot publish a name", async () => {
  await assertFails(setDoc(doc(asAnon(env), "participants_public", "mallory"), pub()));
});

test("a user cannot smuggle extra fields into the public projection", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"),
    pub({ email: "alice@example.org" })));
});

test("a user cannot publish an over-long display name or affiliation", async () => {
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "participants_public", "alice"), pub({ displayName: "x".repeat(81) })));
  await assertFails(setDoc(doc(fs, "participants_public", "alice"), pub({ affiliation: "y".repeat(121) })));
});

test("a user cannot publish an empty display name", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"),
    pub({ displayName: "" })));
});

test("an affiliation is optional", async () => {
  const { affiliation, ...withoutAffiliation } = pub();
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"),
    withoutAffiliation));
});

test("a user can withdraw their own name", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "alice"), pub()));
  await assertSucceeds(deleteDoc(doc(asUser(env, "alice"), "participants_public", "alice")));
});

test("a user cannot delete someone else's public entry", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "bob"), pub()));
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "participants_public", "bob")));
});

test("an admin can remove any public entry", async () => {
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "bob"), pub()));
  await assertSucceeds(deleteDoc(doc(asUser(env, "boss"), "participants_public", "bob")));
});
