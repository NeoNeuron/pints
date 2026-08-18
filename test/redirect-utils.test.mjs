import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  destinationAfterAuth, nextValue, safeNext, withNext,
} from "../js/redirect-utils.mjs";

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
