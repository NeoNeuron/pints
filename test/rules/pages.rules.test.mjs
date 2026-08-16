import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const page = (over = {}) => ({
  markdown: "# Venue\n\nENS, 45 rue d'Ulm.",
  updatedAt: new Date(),
  updatedBy: "boss",
  ...over,
});

test("anyone can read page copy, signed out included", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "pages", "venue"), page()));
  await assertSucceeds(getDoc(doc(asAnon(env), "pages", "venue")));
  await assertSucceeds(getDoc(doc(asUser(env, "alice"), "pages", "venue")));
});

test("a signed-in non-admin cannot edit a page", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "pages", "venue"), page()));
});

test("an anonymous visitor cannot edit a page", async () => {
  await assertFails(setDoc(doc(asAnon(env), "pages", "venue"), page()));
});

test("an admin can write and revert a page", async () => {
  await seedAdmin(env, "boss");
  const fs = asUser(env, "boss");
  await assertSucceeds(setDoc(doc(fs, "pages", "venue"), page()));
  await assertSucceeds(setDoc(doc(fs, "pages", "venue"), page({ markdown: "Moved." })));
  // Reverting to the repo copy is a delete: there is nothing to copy back to.
  await assertSucceeds(deleteDoc(doc(fs, "pages", "venue")));
});

test("an admin cannot write a malformed page", async () => {
  await seedAdmin(env, "boss");
  const fs = asUser(env, "boss");
  await assertFails(setDoc(doc(fs, "pages", "venue"), page({ markdown: 42 })));
  await assertFails(setDoc(doc(fs, "pages", "venue"), page({ surprise: true })));
  await assertFails(setDoc(doc(fs, "pages", "venue"), page({ markdown: "x".repeat(20001) })));
});

test("a 20000 character page is still accepted", async () => {
  await seedAdmin(env, "boss");
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "pages", "venue"),
    page({ markdown: "x".repeat(20000) })));
});

test("a non-admin cannot delete a page to force the repo copy back", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "pages", "venue"), page()));
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "pages", "venue")));
});
