import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { marked } from "../vendor/marked.esm.js";
import createDOMPurify from "../vendor/purify.es.mjs";
import {
  ABSTRACT_ALLOWLIST,
  installStyleFilter,
  renderAbstract,
  renderPage,
  safeStyle,
} from "../js/markdown-render-utils.mjs";

const { window } = new JSDOM("");
// Wired exactly as js/markdown.js wires it, so these tests exercise the
// pipeline the site actually runs rather than a bare sanitizer.
const purify = installStyleFilter(createDOMPurify(window));
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

test("renderPage keeps inline HTML for colouring a run of text", () => {
  const html = renderPage('Talks are <span style="color: red">not yet confirmed</span>.', deps);
  assert.match(html, /<span style="color: red">not yet confirmed<\/span>/);
});

test("renderPage keeps a styled block container", () => {
  const html = renderPage('<div style="text-align: center">Poster session</div>', deps);
  assert.match(html, /<div style="text-align: center">/);
  assert.match(html, /Poster session/);
});

test("renderPage still strips scripts and event handlers written as HTML", () => {
  const html = renderPage('<span onclick="alert(1)">hi</span><script>alert(2)</script>', deps);
  assert.doesNotMatch(html, /onclick/i);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<span>hi<\/span>/);
});

test("renderPage drops a style that survives DOMPurify but not safeStyle", () => {
  const html = renderPage('<span style="position: fixed; top: 0">x</span>', deps);
  assert.doesNotMatch(html, /position/i);
  assert.doesNotMatch(html, /style=/);
  assert.match(html, /<span>x<\/span>/);
});

test("safeStyle keeps presentation properties", () => {
  assert.equal(safeStyle("color: red"), "color: red");
  assert.equal(safeStyle("COLOR : #b00 ; font-weight : bold"), "color: #b00; font-weight: bold");
  assert.equal(safeStyle("margin-top: 2rem; border-left: 3px solid #ccc"),
    "margin-top: 2rem; border-left: 3px solid #ccc");
});

test("safeStyle drops overlay positioning", () => {
  assert.equal(safeStyle("position: fixed"), "");
  assert.equal(safeStyle("z-index: 9999; top: 0; left: 0"), "");
  assert.equal(safeStyle("color: red; position: absolute"), "color: red");
});

test("safeStyle drops values that reach the network or run code", () => {
  assert.equal(safeStyle("background: url(https://tracker.example/p.gif)"), "");
  assert.equal(safeStyle("background-image: URL( 'x' )"), "");
  assert.equal(safeStyle("width: expression(alert(1))"), "");
  assert.equal(safeStyle("color: javascript:alert(1)"), "");
});

test("safeStyle ignores malformed declarations", () => {
  assert.equal(safeStyle("color"), "");
  assert.equal(safeStyle("color:"), "");
  assert.equal(safeStyle(":red"), "");
  assert.equal(safeStyle(""), "");
  assert.equal(safeStyle(null), "");
  assert.equal(safeStyle("color: red;;; font-size: 2rem;"), "color: red; font-size: 2rem");
});

test("renderAbstract gains nothing from the page allowlist", () => {
  const html = renderAbstract('<span style="color: red">participant</span>', deps);
  assert.doesNotMatch(html, /<span/i);
  assert.doesNotMatch(html, /style=/);
  assert.match(html, /participant/);
});

test("markdown keeps working around an inline span, and inside a spaced-out div", () => {
  // marked treats a block-level HTML tag as a raw HTML block, so markdown
  // written tight against <div> is emitted verbatim. A blank line on either
  // side hands the contents back to the parser. The admin editor's hint says
  // so, and this test is what keeps that advice true.
  const inline = renderPage("Deadline is <span>**14 October**</span> sharp.", deps);
  assert.match(inline, /<span><strong>14 October<\/strong><\/span>/);

  const tight = renderPage("<div>**Poster session**</div>", deps);
  assert.doesNotMatch(tight, /<strong>/);

  const spaced = renderPage("<div>\n\n**Poster session**\n\n</div>", deps);
  assert.match(spaced, /<strong>Poster session<\/strong>/);
});
