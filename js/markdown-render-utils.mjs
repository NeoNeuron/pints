/**
 * Rendering pipeline for markdown. `parse` and `sanitize` are injected so this
 * module stays pure and testable under Node.
 *
 * Two allowlists, deliberately different:
 *  - PAGE_ALLOWLIST     page copy, written by organizers we trust. It reaches us
 *    either from content/*.md in the repo or from pages/{slug} in Firestore via
 *    the admin console — same authors either way, since firestore.rules lets
 *    only admins write that collection, and an admin already holds full database
 *    write access. Sanitization still runs: it is what stops a stolen admin
 *    session from turning page copy into script execution.
 *  - ABSTRACT_ALLOWLIST participant-submitted abstract bodies. Untrusted input.
 *    Note it has no "img" — figures are a separate, validated field rendered
 *    with createElement, never through markdown.
 */

export const PAGE_ALLOWLIST = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "p", "br", "hr", "em", "strong", "sup", "sub",
    "a", "ul", "ol", "li", "blockquote", "code", "pre",
    "table", "thead", "tbody", "tr", "th", "td", "img",
  ],
  ALLOWED_ATTR: ["href", "title", "src", "alt", "colspan", "rowspan"],
};

export const ABSTRACT_ALLOWLIST = {
  ALLOWED_TAGS: ["p", "br", "em", "strong", "sup", "sub", "a"],
  ALLOWED_ATTR: ["href"],
  ALLOWED_URI_REGEXP: /^https?:\/\//i,
};

/** Parse then sanitize. Sanitization always runs last. */
export function renderMarkdown(src, { parse, sanitize, config }) {
  if (src === null || src === undefined || String(src).trim() === "") return "";
  return sanitize(parse(String(src)), config);
}

/** Render trusted, repo-authored markdown. */
export function renderPage(src, deps) {
  return renderMarkdown(src, { ...deps, config: PAGE_ALLOWLIST });
}

/** Render untrusted, participant-submitted markdown. */
export function renderAbstract(src, deps) {
  return renderMarkdown(src, { ...deps, config: ABSTRACT_ALLOWLIST });
}
