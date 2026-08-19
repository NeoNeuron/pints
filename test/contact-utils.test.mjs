import test from "node:test";
import assert from "node:assert/strict";
import { validateContact } from "../js/contact-utils.mjs";
import { CONTACT_TOPICS, CONTACT_TOPIC_LABELS, LIMITS } from "../js/config.mjs";

const good = (over = {}) => ({
  name: "Alice Dupont",
  email: "alice@ens.psl.eu",
  topic: "registration",
  message: "Is there a student rate?",
  ...over,
});

test("a well-formed message validates", () => {
  assert.deepEqual(validateContact(good()), { valid: true, errors: [] });
});

test("every topic in CONTACT_TOPICS is accepted and labelled", () => {
  for (const topic of CONTACT_TOPICS) {
    assert.equal(validateContact(good({ topic })).valid, true, topic);
    assert.equal(typeof CONTACT_TOPIC_LABELS[topic], "string", topic);
  }
});

test("name, email and message are all required", () => {
  const { errors } = validateContact({ topic: "other" });
  assert.ok(errors.some((e) => /name is required/i.test(e)));
  assert.ok(errors.some((e) => /email address is required/i.test(e)));
  assert.ok(errors.some((e) => /message is required/i.test(e)));
});

test("whitespace alone is not a value", () => {
  const { errors } = validateContact(good({ name: "   ", message: "\n \t " }));
  assert.ok(errors.some((e) => /name is required/i.test(e)));
  assert.ok(errors.some((e) => /message is required/i.test(e)));
});

test("a malformed address is rejected", () => {
  for (const email of ["alice", "alice@ens", "alice ens.psl.eu", "@ens.psl.eu", "a@b@c.fr"]) {
    const { errors } = validateContact(good({ email }));
    assert.ok(errors.some((e) => /valid email address/.test(e)), email);
  }
});

test("an unknown topic is rejected, and so is a missing one", () => {
  assert.ok(validateContact(good({ topic: "sponsorship" }))
    .errors.some((e) => /what this is about/.test(e)));
  assert.ok(validateContact(good({ topic: undefined }))
    .errors.some((e) => /what this is about/.test(e)));
});

test("the configured limits are enforced", () => {
  const { errors } = validateContact(good({
    name: "x".repeat(LIMITS.displayName + 1),
    message: "y".repeat(LIMITS.contactMessage + 1),
  }));
  assert.ok(errors.some((e) => new RegExp(`${LIMITS.displayName} characters`).test(e)));
  assert.ok(errors.some((e) => new RegExp(`${LIMITS.contactMessage} characters`).test(e)));
});

test("a message exactly at the limit is still accepted", () => {
  assert.equal(validateContact(good({
    name: "x".repeat(LIMITS.displayName),
    message: "y".repeat(LIMITS.contactMessage),
  })).valid, true);
});

test("an over-long address is reported as too long, not as malformed", () => {
  const email = `${"a".repeat(LIMITS.email)}@example.org`;
  const { errors } = validateContact(good({ email }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /email address must be/);
});
