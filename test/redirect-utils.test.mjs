import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  destinationAfterAuth, nextValue, safeContinueUrl, safeNext, withNext,
} from "../js/redirect-utils.mjs";

const ORIGIN = "https://pints.fr";

test("safeNext accepts a page of this site, with or without a fragment", () => {
  assert.equal(safeNext("account.html"), "account.html");
  assert.equal(safeNext("account.html#abstract"), "account.html#abstract");
  assert.equal(safeNext("  previous.html  "), "previous.html");
});

test("safeNext rejects anything that could leave the site", () => {
  for (const hostile of [
    "https://evil.example/account.html",
    "//evil.example",
    "/account.html",
    "../account.html",
    "account.html?x=1",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ]) {
    assert.equal(safeNext(hostile), null, `should reject ${String(hostile)}`);
  }
});

test("destinationAfterAuth falls back to the right console", () => {
  assert.equal(destinationAfterAuth(null, { isAdmin: false }), "account.html");
  assert.equal(destinationAfterAuth(null, { isAdmin: true }), "admin.html");
  assert.equal(destinationAfterAuth("//evil.example", { isAdmin: true }), "admin.html");
  assert.equal(destinationAfterAuth("account.html#abstract", { isAdmin: true }),
    "account.html#abstract");
});

test("nextValue joins the page and its fragment", () => {
  assert.equal(nextValue("account.html", "#abstract"), "account.html#abstract");
  assert.equal(nextValue("index.html"), "index.html");
  assert.equal(nextValue("index.html", "#a b"), null);
});

test("withNext only appends a target it would follow", () => {
  assert.equal(withNext("register.html", "account.html#abstract"),
    "register.html?next=account.html%23abstract");
  assert.equal(withNext("register.html", null), "register.html");
  assert.equal(withNext("register.html", "https://evil.example"), "register.html");
});

// ------------------------------------------------- the Firebase continueUrl

test("safeContinueUrl accepts our own pages, absolute or rooted", () => {
  assert.equal(safeContinueUrl("https://pints.fr/account.html", ORIGIN), "account.html");
  assert.equal(safeContinueUrl("https://pints.fr/account.html#abstract", ORIGIN),
    "account.html#abstract");
  assert.equal(safeContinueUrl("/submit.html", ORIGIN), "submit.html");
  assert.equal(safeContinueUrl("  https://pints.fr/index.html  ", ORIGIN), "index.html");
});

test("safeContinueUrl rejects anything that would leave the site", () => {
  for (const hostile of [
    "https://evil.example/account.html",
    "//evil.example/account.html",
    "http://pints.fr.evil.example/account.html",
    // Same name, wrong scheme: origin comparison is exact, and it must be.
    "http://pints.fr/account.html",
    "javascript:alert(1)",
    "",
    "   ",
    null,
    undefined,
  ]) {
    assert.equal(safeContinueUrl(hostile, ORIGIN), null, `should reject ${String(hostile)}`);
  }
});

test("safeContinueUrl still applies the safeNext shape to what survives", () => {
  // Same origin, but not a page of ours in the shape safeNext() allows.
  assert.equal(safeContinueUrl("https://pints.fr/account.html?token=x", ORIGIN), null);
  assert.equal(safeContinueUrl("https://pints.fr/", ORIGIN), null);
  assert.equal(safeContinueUrl("https://pints.fr/assets/pints-mark.svg", ORIGIN), null);
});

test("safeContinueUrl needs an origin to compare against", () => {
  assert.equal(safeContinueUrl("https://pints.fr/account.html", undefined), null);
});
