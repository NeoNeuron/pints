import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seedAdmin, seedConfig } from "./helpers.mjs";

let env;

before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

test("anyone can read config/site", async () => {
  await seedConfig(env);
  await assertSucceeds(getDoc(doc(asAnon(env), "config", "site")));
});

test("a signed-in non-admin cannot write config/site", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "config", "site"), { submissionsOpen: false }));
});

test("an anonymous visitor cannot write config/site", async () => {
  await assertFails(setDoc(doc(asAnon(env), "config", "site"), { submissionsOpen: false }));
});

test("an admin can write config/site", async () => {
  await seedAdmin(env, "boss");
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "config", "site"), { submissionsOpen: false }));
});

test("unmatched collections are denied to everyone", async () => {
  await seedAdmin(env, "boss");
  await assertFails(getDoc(doc(asAnon(env), "whatever", "x")));
  await assertFails(getDoc(doc(asUser(env, "alice"), "whatever", "x")));
  await assertFails(setDoc(doc(asUser(env, "boss"), "whatever", "x"), { a: 1 }));
});
