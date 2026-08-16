import test from "node:test";
import assert from "node:assert/strict";
import {
  commitMessage,
  contentsUrl,
  explainGithubError,
  fromBase64Utf8,
  toBase64Utf8,
} from "../js/github-utils.mjs";

// btoa() throws on anything above U+00FF, and this site's copy is full of
// accented French. Encoding to UTF-8 bytes first is what makes it survive.
test("base64 round-trips accented and non-Latin text", () => {
  for (const text of [
    "Île-de-France",
    "# Venue\n\nÉcole normale supérieure, 45 rue d'Ulm — café ☕",
    "",
    "plain ascii",
  ]) {
    assert.equal(fromBase64Utf8(toBase64Utf8(text)), text);
  }
});

test("base64 handles a page larger than the chunking threshold", () => {
  const big = "é".repeat(40000);
  assert.equal(fromBase64Utf8(toBase64Utf8(big)), big);
});

test("toBase64Utf8 treats nullish input as empty", () => {
  assert.equal(toBase64Utf8(undefined), "");
  assert.equal(toBase64Utf8(null), "");
});

test("fromBase64Utf8 tolerates the newlines the GitHub API inserts", () => {
  const encoded = toBase64Utf8("hello world, this is long enough to matter");
  const withBreaks = encoded.replace(/(.{8})/g, "$1\n");
  assert.equal(fromBase64Utf8(withBreaks), "hello world, this is long enough to matter");
});

test("contentsUrl keeps path separators but escapes each segment", () => {
  assert.equal(
    contentsUrl({ owner: "NeoNeuron", name: "pints", path: "content/about.md" }),
    "https://api.github.com/repos/NeoNeuron/pints/contents/content/about.md",
  );
  assert.match(contentsUrl({ owner: "o", name: "r", path: "a b/c.md" }), /a%20b\/c\.md$/);
});

test("commitMessage follows the repository's existing subject style", () => {
  const message = commitMessage("Venue", "content/venue.md");
  assert.match(message.split("\n")[0], /^content: /);
  assert.match(message, /content\/venue\.md/);
});

test("explainGithubError names the fix for each status an organizer will hit", () => {
  assert.match(explainGithubError(401), /token/i);
  assert.match(explainGithubError(403), /Contents: Read and write/);
  assert.match(explainGithubError(404), /404/);
  assert.match(explainGithubError(409), /reload/i);
  assert.match(explainGithubError(500), /500/);
});
