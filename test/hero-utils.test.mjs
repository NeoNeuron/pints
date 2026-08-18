import test from "node:test";
import assert from "node:assert/strict";
import { heroPath, heroPhotos, movePhoto } from "../js/hero-utils.mjs";
import { HERO } from "../js/config.mjs";

test("heroPhotos keeps the document order", () => {
  const doc = { photos: [{ url: "https://x/1.jpg" }, { url: "https://x/2.jpg" }] };
  assert.deepEqual(heroPhotos(doc).map((p) => p.url), ["https://x/1.jpg", "https://x/2.jpg"]);
});

test("heroPhotos drops entries with no usable url", () => {
  const doc = {
    photos: [
      { url: "https://x/1.jpg" },
      { url: "   " },
      { url: null },
      {},
      { url: "https://x/2.jpg" },
    ],
  };
  assert.equal(heroPhotos(doc).length, 2);
});

test("heroPhotos fills in the optional fields as strings", () => {
  const [photo] = heroPhotos({ photos: [{ url: "https://x/1.jpg" }] });
  assert.equal(photo.alt, "");
  assert.equal(photo.path, "");
});

test("heroPhotos caps the list at HERO.maxPhotos", () => {
  const photos = Array.from({ length: HERO.maxPhotos + 5 }, (_, i) => ({ url: `https://x/${i}.jpg` }));
  assert.equal(heroPhotos({ photos }).length, HERO.maxPhotos);
});

test("heroPhotos survives a missing or empty document", () => {
  assert.deepEqual(heroPhotos(null), []);
  assert.deepEqual(heroPhotos(undefined), []);
  assert.deepEqual(heroPhotos({}), []);
  assert.deepEqual(heroPhotos({ photos: [] }), []);
});

test("heroPath puts the uid in the path, so storage.rules can check it", () => {
  assert.equal(heroPath("uid1", "abc"), "hero/uid1/abc");
});

test("movePhoto moves an entry without mutating the original", () => {
  const photos = [{ url: "a" }, { url: "b" }, { url: "c" }];
  assert.deepEqual(movePhoto(photos, 2, 0).map((p) => p.url), ["c", "a", "b"]);
  assert.deepEqual(movePhoto(photos, 0, 1).map((p) => p.url), ["b", "a", "c"]);
  assert.deepEqual(photos.map((p) => p.url), ["a", "b", "c"]);
});

test("movePhoto ignores an index that is off either end", () => {
  const photos = [{ url: "a" }, { url: "b" }];
  assert.deepEqual(movePhoto(photos, -1, 0).map((p) => p.url), ["a", "b"]);
  assert.deepEqual(movePhoto(photos, 0, 2).map((p) => p.url), ["a", "b"]);
  assert.deepEqual(movePhoto(photos, 5, 0).map((p) => p.url), ["a", "b"]);
});
