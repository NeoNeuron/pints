import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin, seedConfig } from "./helpers.mjs";

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

// config/hero is what index.html paints behind the logo, so it is shape-checked
// even though only an organizer can write it -- see validHero in firestore.rules.
const hero = (over = {}) => ({
  photos: [{ path: "hero/olivia/abc", url: "https://x/abc.jpg", alt: "" }],
  updatedAt: new Date(),
  updatedBy: "olivia",
  ...over,
});

test("anyone can read config/hero, because the home page works signed out", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "config", "hero"), hero()));
  await assertSucceeds(getDoc(doc(asAnon(env), "config", "hero")));
});

test("a non-admin cannot write config/hero", async () => {
  await assertFails(setDoc(doc(asAnon(env), "config", "hero"), hero()));
  await assertFails(setDoc(doc(asUser(env, "alice"), "config", "hero"), hero()));
});

test("an admin can write a well-formed config/hero", async () => {
  await seedAdmin(env, "boss");
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "config", "hero"), hero()));
});

test("an empty list is well-formed: it is how the hero is cleared", async () => {
  await seedAdmin(env, "boss");
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "config", "hero"), hero({ photos: [] })));
});

test("config/hero is refused when photos is not a list", async () => {
  await seedAdmin(env, "boss");
  await assertFails(setDoc(doc(asUser(env, "boss"), "config", "hero"), hero({ photos: "one.jpg" })));
});

test("config/hero is refused when photos is missing", async () => {
  await seedAdmin(env, "boss");
  await assertFails(setDoc(doc(asUser(env, "boss"), "config", "hero"),
    { updatedAt: new Date(), updatedBy: "boss" }));
});

test("config/hero is refused past HERO.maxPhotos", async () => {
  await seedAdmin(env, "boss");
  const photos = Array.from({ length: 13 }, (_, i) => ({ path: `p${i}`, url: `https://x/${i}.jpg`, alt: "" }));
  await assertFails(setDoc(doc(asUser(env, "boss"), "config", "hero"), hero({ photos })));
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "config", "hero"),
    hero({ photos: photos.slice(0, 12) })));
});

test("config/hero is refused an unknown field", async () => {
  await seedAdmin(env, "boss");
  await assertFails(setDoc(doc(asUser(env, "boss"), "config", "hero"), hero({ script: "alert(1)" })));
});

// The hero check is a condition on docId inside match /config/{docId}, so this
// is the test that it did not tighten anything else in the collection.
test("the hero shape check does not apply to config/site", async () => {
  await seedAdmin(env, "boss");
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "config", "site"),
    { submissionsOpen: true, edition: "2026", deadline: "2026-10-01" }));
});

test("unmatched collections are denied to everyone", async () => {
  await seedAdmin(env, "boss");
  await assertFails(getDoc(doc(asAnon(env), "whatever", "x")));
  await assertFails(getDoc(doc(asUser(env, "alice"), "whatever", "x")));
  await assertFails(setDoc(doc(asUser(env, "boss"), "whatever", "x"), { a: 1 }));
});
