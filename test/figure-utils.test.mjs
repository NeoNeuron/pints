import test from "node:test";
import assert from "node:assert/strict";
import { figurePath, outputType, targetSize, validateFigure } from "../js/figure-utils.mjs";
import { FIGURE } from "../js/config.mjs";

test("validateFigure accepts the three allowed image types", () => {
  for (const type of FIGURE.types) {
    assert.ok(validateFigure({ type, size: 1000 }).valid, `${type} should be accepted`);
  }
});

test("validateFigure rejects other content types", () => {
  for (const type of ["application/pdf", "image/gif", "text/plain", "", undefined]) {
    const { valid, errors } = validateFigure({ type, size: 1000 });
    assert.equal(valid, false);
    assert.ok(errors.some((e) => /PNG, JPEG, or WebP/.test(e)));
  }
});

test("validateFigure rejects an oversized file", () => {
  const { valid, errors } = validateFigure({ type: "image/png", size: FIGURE.maxBytes + 1 });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /MB/.test(e)));
});

test("validateFigure rejects an empty file", () => {
  assert.equal(validateFigure({ type: "image/png", size: 0 }).valid, false);
  assert.equal(validateFigure({ type: "image/png" }).valid, false);
});

test("targetSize leaves an already-small image alone", () => {
  assert.deepEqual(targetSize(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(targetSize(1600, 1200, 1600), { width: 1600, height: 1200 });
});

test("targetSize scales the longest edge down and preserves the aspect ratio", () => {
  assert.deepEqual(targetSize(3200, 1600, 1600), { width: 1600, height: 800 });
  assert.deepEqual(targetSize(1600, 3200, 1600), { width: 800, height: 1600 });
});

test("targetSize never returns a zero dimension for a very thin image", () => {
  const { width, height } = targetSize(10000, 3, 1600);
  assert.equal(width, 1600);
  assert.ok(height >= 1);
});

test("targetSize copes with missing dimensions", () => {
  assert.deepEqual(targetSize(0, 0), { width: 0, height: 0 });
  assert.deepEqual(targetSize(undefined, undefined), { width: 0, height: 0 });
});

test("outputType keeps PNG but re-encodes everything else as JPEG", () => {
  // PNG stays PNG because it may carry transparency a JPEG would black out.
  assert.equal(outputType("image/png"), "image/png");
  assert.equal(outputType("image/jpeg"), "image/jpeg");
  assert.equal(outputType("image/webp"), "image/jpeg");
});

test("figurePath puts the owner uid in the path, which is what storage.rules checks", () => {
  assert.equal(figurePath("uid123", "abs456"), "abstract_figures/uid123/abs456");
});
