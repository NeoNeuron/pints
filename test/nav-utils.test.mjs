import test from "node:test";
import assert from "node:assert/strict";
import { currentPageFile, markActive } from "../js/nav-utils.mjs";

const NAV = [
  { href: "index.html", label: "Home" },
  { href: "program.html", label: "Program" },
];

test("currentPageFile returns the file name from a path", () => {
  assert.equal(currentPageFile("/pints/program.html"), "program.html");
  assert.equal(currentPageFile("/program.html"), "program.html");
});

test("currentPageFile treats a directory path as index.html", () => {
  assert.equal(currentPageFile("/"), "index.html");
  assert.equal(currentPageFile("/pints/"), "index.html");
  assert.equal(currentPageFile(""), "index.html");
});

test("markActive flags exactly the current page", () => {
  const marked = markActive(NAV, "/pints/program.html");
  assert.deepEqual(marked.map((i) => i.active), [false, true]);
});

test("markActive flags home for a bare directory path", () => {
  const marked = markActive(NAV, "/pints/");
  assert.deepEqual(marked.map((i) => i.active), [true, false]);
});

test("markActive does not mutate the input nav", () => {
  const input = [{ href: "index.html", label: "Home" }];
  markActive(input, "/");
  assert.deepEqual(input, [{ href: "index.html", label: "Home" }]);
});
