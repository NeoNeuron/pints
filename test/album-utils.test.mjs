import test from "node:test";
import assert from "node:assert/strict";
import {
  archivePath,
  importedFromHero,
  movePhoto,
  ownsObject,
  yearInHeading,
} from "../js/album-utils.mjs";

// yearInHeading is the whole anchoring rule, so it is worth pinning down: an
// album that cannot find its heading falls back to the foot of the page, which
// is a silent demotion rather than a visible failure.
test("yearInHeading finds the edition in the headings actually on the page", () => {
  assert.equal(yearInHeading("PINTS 2025"), 2025);
  assert.equal(yearInHeading("PINTS 2022"), 2022);
});

test("yearInHeading does not care how the heading is worded", () => {
  assert.equal(yearInHeading("The 2025 meeting"), 2025);
  assert.equal(yearInHeading("2024"), 2024);
  assert.equal(yearInHeading("  Edition of 2019, in Paris  "), 2019);
});

test("yearInHeading finds nothing when there is no year to find", () => {
  assert.equal(yearInHeading("Last year"), null);
  assert.equal(yearInHeading(""), null);
  assert.equal(yearInHeading(undefined), null);
  assert.equal(yearInHeading(null), null);
});

test("yearInHeading ignores numbers that are not years", () => {
  assert.equal(yearInHeading("12 talks and 40 posters"), null);
  assert.equal(yearInHeading("PINTS 20255"), null, "not a four-digit year on its own");
});

test("yearInHeading takes the first year, so a heading naming two is not ambiguous", () => {
  assert.equal(yearInHeading("PINTS 2025, held in 2026"), 2025);
});

test("archivePath puts the uid in the path, so storage.rules can check it", () => {
  assert.equal(archivePath("u1", "abc"), "archive/u1/abc");
});

// The prefix is the delete permission. Getting this backwards deletes a
// photograph out from under the home page hero.
test("ownsObject is true only for what the Archive tab uploaded", () => {
  assert.equal(ownsObject("archive/u1/abc"), true);
  assert.equal(ownsObject("hero/u1/abc"), false, "imported: the hero still points at it");
  assert.equal(ownsObject("abstract_figures/u1/abc"), false);
  assert.equal(ownsObject(""), false, "a Dropbox entry has no object of ours");
  assert.equal(ownsObject(undefined), false);
  assert.equal(ownsObject(null), false);
});

const hero = [
  { path: "hero/u1/a", url: "https://x/a.jpg", alt: "The poster session" },
  { path: "hero/u1/b", url: "https://x/b.jpg", alt: "" },
];

test("importedFromHero turns hero entries into album entries", () => {
  assert.deepEqual(importedFromHero(hero, []), [
    { name: "a", url: "https://x/a.jpg", caption: "The poster session", path: "hero/u1/a" },
    { name: "b", url: "https://x/b.jpg", caption: "", path: "hero/u1/b" },
  ]);
});

test("importing twice adds nothing the second time", () => {
  const first = importedFromHero(hero, []);
  assert.deepEqual(importedFromHero(hero, first), []);
});

test("importedFromHero only skips what is already there", () => {
  const [onlyB] = importedFromHero(hero, [{ path: "hero/u1/a" }]);
  assert.equal(onlyB.path, "hero/u1/b");
});

// Matched on path rather than url: a download url carries a token that can be
// reissued for the same object, so two urls can be one photograph.
test("importedFromHero matches on the object, not on the url", () => {
  const moved = [{ path: "hero/u1/a", url: "https://x/a.jpg?token=new" }];
  assert.deepEqual(importedFromHero(hero, moved).map((p) => p.path), ["hero/u1/b"]);
});

test("importedFromHero survives an empty or missing hero", () => {
  assert.deepEqual(importedFromHero([], []), []);
  assert.deepEqual(importedFromHero(undefined, undefined), []);
});

test("importedFromHero skips an entry with no object behind it", () => {
  assert.deepEqual(importedFromHero([{ url: "https://x/c.jpg" }], []), []);
});

test("movePhoto moves an entry without mutating the original", () => {
  const photos = [{ url: "a" }, { url: "b" }, { url: "c" }];
  assert.deepEqual(movePhoto(photos, 2, 0).map((p) => p.url), ["c", "a", "b"]);
  assert.deepEqual(movePhoto(photos, 0, 1).map((p) => p.url), ["b", "a", "c"]);
  assert.deepEqual(photos.map((p) => p.url), ["a", "b", "c"], "the original is untouched");
});

test("movePhoto ignores an index that is off either end", () => {
  const photos = [{ url: "a" }, { url: "b" }];
  assert.deepEqual(movePhoto(photos, -1, 0).map((p) => p.url), ["a", "b"]);
  assert.deepEqual(movePhoto(photos, 0, 2).map((p) => p.url), ["a", "b"]);
  assert.deepEqual(movePhoto(photos, 5, 0).map((p) => p.url), ["a", "b"]);
  assert.deepEqual(movePhoto(undefined, 0, 1), []);
});
