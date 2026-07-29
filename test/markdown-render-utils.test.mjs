import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { marked } from "../vendor/marked.esm.js";
import createDOMPurify from "../vendor/purify.es.mjs";
import {
  ABSTRACT_ALLOWLIST,
  renderAbstract,
  renderPage,
} from "../js/markdown-render-utils.mjs";

const { window } = new JSDOM("");
const purify = createDOMPurify(window);
const deps = {
  parse: (src) => marked.parse(src),
  sanitize: (html, config) => purify.sanitize(html, config),
};

test("renderPage renders ordinary markdown", () => {
  const html = renderPage("# Venue\n\nSee the [map](https://example.org/map).", deps);
  assert.match(html, /<h1[^>]*>Venue<\/h1>/);
  assert.match(html, /href="https:\/\/example\.org\/map"/);
});

test("renderAbstract keeps the scientific inline subset", () => {
  const html = renderAbstract("Firing rate *increased* by **40%** in V1^2^.", deps);
  assert.match(html, /<em>increased<\/em>/);
  assert.match(html, /<strong>40%<\/strong>/);
});

test("renderAbstract strips script tags", () => {
  const html = renderAbstract("Hello <script>alert(1)</script> world", deps);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /alert\(1\)/);
});

test("renderAbstract strips event handler attributes", () => {
  const html = renderAbstract('<img src="x" onerror="alert(1)">', deps);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /<img/i);
});

test("renderAbstract strips javascript: URLs", () => {
  const html = renderAbstract("[click](javascript:alert(1))", deps);
  assert.doesNotMatch(html, /javascript:/i);
});

test("renderAbstract drops block-level markup outside the allowlist", () => {
  const html = renderAbstract("# Not a heading here\n\n- not a list", deps);
  assert.doesNotMatch(html, /<h1/i);
  assert.doesNotMatch(html, /<ul/i);
  assert.match(html, /Not a heading here/);
});

test("the abstract allowlist is exactly the intended tag set", () => {
  assert.deepEqual(ABSTRACT_ALLOWLIST.ALLOWED_TAGS.slice().sort(), [
    "a", "br", "em", "p", "strong", "sub", "sup",
  ]);
});

test("empty and missing input render as an empty string", () => {
  assert.equal(renderAbstract("", deps), "");
  assert.equal(renderAbstract("   ", deps), "");
  assert.equal(renderAbstract(null, deps), "");
  assert.equal(renderAbstract(undefined, deps), "");
});
