import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const gallery = (over = {}) => ({
  year: 2025,
  folderUrl: "https://www.dropbox.com/scl/fo/abc/def?rlkey=xyz",
  photos: [{ name: "01.jpg", url: "https://www.dropbox.com/s/1/01.jpg?raw=1", caption: "" }],
  syncedAt: new Date(),
  syncedBy: "olivia",
  ...over,
});

// The archive page has to work signed out, so this is read-public by design.
test("anyone can read the gallery, signed in or not", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "gallery", "2025"), gallery()));
  await assertSucceeds(getDoc(doc(asAnon(env), "gallery", "2025")));
  await assertSucceeds(getDocs(collection(asAnon(env), "gallery")));
  await assertSucceeds(getDocs(collection(asUser(env, "alice"), "gallery")));
});

test("only an organizer can write it", async () => {
  await seedAdmin(env, "olivia");
  await assertFails(setDoc(doc(asAnon(env), "gallery", "2025"), gallery()));
  await assertFails(setDoc(doc(asUser(env, "alice"), "gallery", "2025"), gallery()));
  await assertSucceeds(setDoc(doc(asUser(env, "olivia"), "gallery", "2025"), gallery()));
});

test("only an organizer can delete a year", async () => {
  await seedAdmin(env, "olivia");
  await seed(env, (fs) => setDoc(doc(fs, "gallery", "2025"), gallery()));
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "gallery", "2025")));
  await assertSucceeds(deleteDoc(doc(asUser(env, "olivia"), "gallery", "2025")));
});

// A public page renders whatever lands here, and two different writers reach it
// — the sync callable and the caption editor — so the shape is checked rather
// than assumed.
test("the shape is enforced even for an organizer", async () => {
  await seedAdmin(env, "olivia");
  const fs = asUser(env, "olivia");
  const bad = (over) => assertFails(setDoc(doc(fs, "gallery", "2025"), gallery(over)));
  await bad({ year: "2025" });
  await bad({ photos: "01.jpg" });
  await bad({ photos: Array.from({ length: 201 }, (_, i) => ({ url: `https://x/${i}.jpg` })) });
  await bad({ folderUrl: "u".repeat(501) });
  await bad({ script: "<script>" });

  const { photos, ...noPhotos } = gallery();
  await assertFails(setDoc(doc(fs, "gallery", "2025"), noPhotos));
});

test("a year with no photos yet is allowed — that is what a failed sync leaves", async () => {
  await seedAdmin(env, "olivia");
  await assertSucceeds(setDoc(doc(asUser(env, "olivia"), "gallery", "2025"),
    gallery({ photos: [] })));
});

// Photo entries carry `path` for anything uploaded rather than synced from
// Dropbox. Nothing in the rule mentions it today, which is the point: this test
// fails loudly here if someone adds a per-entry hasOnly() that leaves it out,
// rather than silently in the admin console.
test("a photo entry may carry the Storage object behind it", async () => {
  await seedAdmin(env, "olivia");
  await assertSucceeds(setDoc(doc(asUser(env, "olivia"), "gallery", "2025"), gallery({
    folderUrl: "",
    photos: [
      { name: "abc", url: "https://x/abc.jpg", caption: "", path: "archive/olivia/abc" },
      { name: "def", url: "https://x/def.jpg", caption: "", path: "hero/olivia/def" },
    ],
  })));
});
