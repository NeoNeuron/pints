import { ABSTRACT_TYPES, LIMITS } from "./config.mjs";

/** One affiliation per line; blanks dropped. */
export function parseAffiliations(text) {
  return String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

/** "1,2" (what the author types) -> [0,1] (what we store). */
export function parseAffiliationIndexes(input) {
  return String(input ?? "").trim()
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((token) => Number(token) - 1);
}

/**
 * Validate an abstract before writing it.
 *
 * firestore.rules enforces the same limits server-side; this exists to give
 * people a readable list of problems instead of a PERMISSION_DENIED.
 */
export function validateAbstract(
  input,
  { now = new Date(), submissionsOpen = true, deadline = null } = {},
) {
  const errors = [];
  const title = String(input?.title ?? "").trim();
  const body = String(input?.body ?? "").trim();
  const authors = Array.isArray(input?.authors) ? input.authors : [];
  const affiliations = Array.isArray(input?.affiliations) ? input.affiliations : [];

  if (!submissionsOpen) errors.push("Submissions are closed.");
  if (deadline && now > new Date(deadline)) errors.push("The submission deadline has passed.");

  if (!title) errors.push("Title is required.");
  else if (title.length > LIMITS.title) {
    errors.push(`Title must be ${LIMITS.title} characters or fewer.`);
  }

  if (!body) errors.push("Abstract body is required.");
  else if (body.length > LIMITS.body) {
    errors.push(`Abstract must be ${LIMITS.body} characters or fewer.`);
  }

  if (affiliations.length > LIMITS.affiliations) {
    errors.push(`No more than ${LIMITS.affiliations} affiliations.`);
  }

  if (authors.length === 0) errors.push("At least one author is required.");
  else if (authors.length > LIMITS.authors) {
    errors.push(`No more than ${LIMITS.authors} authors.`);
  }

  authors.forEach((author, i) => {
    if (!String(author?.name ?? "").trim()) errors.push(`Author ${i + 1} needs a name.`);
    for (const index of author?.affiliationIndexes ?? []) {
      if (!Number.isInteger(index) || index < 0 || index >= affiliations.length) {
        errors.push(`Author ${i + 1} refers to affiliation ${index + 1}, which does not exist.`);
      }
    }
  });

  const presenting = authors.filter((a) => a?.presenting).length;
  if (presenting === 0) errors.push("Mark one presenting author.");
  else if (presenting > 1) errors.push("There can be only one presenting author.");

  if (!ABSTRACT_TYPES.includes(input?.type)) {
    errors.push("Presentation type must be poster or talk.");
  }

  return { valid: errors.length === 0, errors };
}
