import test from "node:test";
import assert from "node:assert/strict";
import {
  galleryYears, neighbourIndexes, slideLabel, stepIndex,
} from "../js/slideshow-utils.mjs";

const docs = [
  { year: 2024, photos: [{ name: "a.jpg", url: "https://x/a.jpg", caption: "Keynote" }] },
  {
    year: 2025,
    photos: [
      { name: "1.jpg", url: "https://x/1.jpg" },
      { name: "2.jpg", url: "https://x/2.jpg", caption: "Posters" },
    ],
  },
];

test("galleryYears puts the newest edition first", () => {
  assert.deepEqual(galleryYears(docs).map((y) => y.year), [2025, 2024]);
});

test("galleryYears fills in the fields the slideshow reads", () => {
  const [newest] = galleryYears(docs);
  assert.deepEqual(newest.photos[0], { name: "1.jpg", url: "https://x/1.jpg", caption: "" });
  assert.equal(newest.photos[1].caption, "Posters");
});

test("galleryYears drops entries with no usable image, and years left empty", () => {
  const messy = galleryYears([
    { year: 2023, photos: [{ name: "broken" }, { url: "   " }, { url: null }] },
    { year: 2022, photos: [{ url: "https://x/ok.jpg" }, { name: "no url" }] },
    { year: 2021, photos: [] },
    { year: "not a year", photos: [{ url: "https://x/y.jpg" }] },
  ]);
  assert.deepEqual(messy.map((y) => y.year), [2022]);
  assert.equal(messy[0].photos.length, 1);
});

test("galleryYears on nothing at all", () => {
  assert.deepEqual(galleryYears(undefined), []);
  assert.deepEqual(galleryYears([]), []);
});

test("stepIndex wraps at both ends", () => {
  assert.equal(stepIndex(0, 1, 3), 1);
  assert.equal(stepIndex(2, 1, 3), 0, "past the last photo comes the first");
  assert.equal(stepIndex(0, -1, 3), 2, "before the first comes the last");
  assert.equal(stepIndex(1, 5, 3), 0);
  assert.equal(stepIndex(1, -5, 3), 2);
});

test("stepIndex refuses to produce an index into nothing", () => {
  assert.equal(stepIndex(4, 1, 0), 0);
  assert.equal(stepIndex(0, 1, undefined), 0);
  assert.equal(stepIndex(undefined, 1, 3), 1);
});

test("slideLabel counts from one, and says nothing about an empty gallery", () => {
  assert.equal(slideLabel(0, 12), "1 of 12");
  assert.equal(slideLabel(11, 12), "12 of 12");
  assert.equal(slideLabel(0, 0), "");
  assert.equal(slideLabel(0, undefined), "");
});

test("neighbourIndexes names the slide on either side", () => {
  assert.deepEqual(neighbourIndexes(2, 5), [3, 1]);
  assert.deepEqual(neighbourIndexes(0, 5), [1, 4], "it wraps around the ends");
  assert.deepEqual(neighbourIndexes(4, 5), [0, 3]);
});

test("neighbourIndexes has nothing to preload for a gallery of one or none", () => {
  assert.deepEqual(neighbourIndexes(0, 1), []);
  assert.deepEqual(neighbourIndexes(0, 0), []);
  assert.deepEqual(neighbourIndexes(0, undefined), []);
  assert.deepEqual(neighbourIndexes(0, 2), [1], "two slides share one neighbour");
});
