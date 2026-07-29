import test from "node:test";
import assert from "node:assert/strict";
import { lastNameKey, sortParticipants } from "../js/participant-utils.mjs";

test("lastNameKey takes the final whitespace-separated token", () => {
  assert.equal(lastNameKey("Alice Dupont"), "Dupont");
  assert.equal(lastNameKey("Jean-Luc  de  Villiers"), "Villiers");
  assert.equal(lastNameKey("  Cher  "), "Cher");
  assert.equal(lastNameKey(""), "");
  assert.equal(lastNameKey(undefined), "");
});

test("sortParticipants orders by last name", () => {
  const sorted = sortParticipants([
    { displayName: "Zoe Aaron" },
    { displayName: "Alice Dupont" },
    { displayName: "Bob Castel" },
  ]);
  assert.deepEqual(sorted.map((p) => p.displayName), ["Zoe Aaron", "Bob Castel", "Alice Dupont"]);
});

test("sortParticipants is accent-insensitive", () => {
  const sorted = sortParticipants([
    { displayName: "X Zeta" },
    { displayName: "Y Émile" },
    { displayName: "Z Fabre" },
  ]);
  assert.deepEqual(sorted.map((p) => p.displayName), ["Y Émile", "Z Fabre", "X Zeta"]);
});

test("sortParticipants breaks last-name ties on the full name", () => {
  const sorted = sortParticipants([
    { displayName: "Zoe Martin" },
    { displayName: "Anne Martin" },
  ]);
  assert.deepEqual(sorted.map((p) => p.displayName), ["Anne Martin", "Zoe Martin"]);
});

test("sortParticipants does not mutate its input", () => {
  const input = [{ displayName: "B B" }, { displayName: "A A" }];
  sortParticipants(input);
  assert.deepEqual(input.map((p) => p.displayName), ["B B", "A A"]);
});

test("sortParticipants tolerates missing names", () => {
  const sorted = sortParticipants([{ displayName: "A Zed" }, {}, { displayName: "" }]);
  assert.equal(sorted.length, 3);
});
