import { CONTACT_TOPICS, LIMITS } from "./config.mjs";

// Shape only, deliberately. There is no regex that decides whether an address
// exists, and a strict one rejects real addresses — so this catches the typo
// ("alice@ens", a stray space) and leaves the rest to whether the reply
// bounces. firestore.rules checks the length; this checks the shape.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a contact message before writing it.
 *
 * Returns the same `{ valid, errors }` shape as validateAbstract(), and exists
 * for the same reason: firestore.rules enforces these limits server-side, and
 * a PERMISSION_DENIED is not something a visitor can act on.
 */
export function validateContact(input) {
  const errors = [];
  const name = String(input?.name ?? "").trim();
  const email = String(input?.email ?? "").trim();
  const message = String(input?.message ?? "").trim();

  if (!name) errors.push("Your name is required.");
  else if (name.length > LIMITS.displayName) {
    errors.push(`Your name must be ${LIMITS.displayName} characters or fewer.`);
  }

  if (!email) errors.push("Your email address is required.");
  else if (email.length > LIMITS.email) {
    errors.push(`Your email address must be ${LIMITS.email} characters or fewer.`);
  } else if (!EMAIL.test(email)) {
    errors.push("That does not look like a valid email address.");
  }

  if (!CONTACT_TOPICS.includes(input?.topic)) errors.push("Choose what this is about.");

  if (!message) errors.push("A message is required.");
  else if (message.length > LIMITS.contactMessage) {
    errors.push(`Your message must be ${LIMITS.contactMessage} characters or fewer.`);
  }

  return { valid: errors.length === 0, errors };
}
