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
    // Written by hand in the admin editor, because markdown has no syntax for
    // any of it. `span` and `div` are the two containers you need to colour or
    // centre a run of text; the rest are inline emphasis with no markdown
    // equivalent. See safeStyle() for what a `style` attribute may carry.
    "span", "div", "u", "s", "small", "mark",
  ],
  ALLOWED_ATTR: ["href", "title", "src", "alt", "colspan", "rowspan", "style", "class"],
};

export const ABSTRACT_ALLOWLIST = {
  ALLOWED_TAGS: ["p", "br", "em", "strong", "sup", "sub", "a"],
  ALLOWED_ATTR: ["href"],
  ALLOWED_URI_REGEXP: /^https?:\/\//i,
};

/**
 * CSS properties an organizer may set from the page editor.
 *
 * Presentation only. The notable absences are `position`, `z-index`, and the
 * offset properties that go with them: those are what turn a styled word into
 * an invisible layer over the rest of the page, and no piece of conference copy
 * needs them. Everything here is inert on its own.
 */
const SAFE_CSS_PROPERTIES = new Set([
  "color", "opacity", "display", "float", "clear", "vertical-align",
  "width", "max-width", "min-width", "height", "max-height", "min-height",
  "line-height", "letter-spacing", "word-spacing", "white-space",
  "list-style", "list-style-type", "border-radius", "box-shadow",
]);

/** Property families allowed in full, e.g. `margin-top`, `border-left-color`. */
const SAFE_CSS_PREFIXES = ["margin", "padding", "border", "font", "text", "background"];

// url() is the one function that reaches the network, which turns a page view
// into a signal to whoever wrote the copy; expression() is the ancient IE
// script vector. Neither belongs in page copy, and rejecting the token is
// simpler and harder to get wrong than trying to parse what is inside it.
const UNSAFE_CSS_VALUE = /url\s*\(|expression\s*\(|javascript:|@import/i;

const propertyAllowed = (name) =>
  SAFE_CSS_PROPERTIES.has(name)
  || SAFE_CSS_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}-`));

/**
 * Keep the declarations a page may carry and drop the rest.
 *
 * Returns "" when nothing survives, which is the caller's cue to remove the
 * attribute rather than leave an empty one behind.
 */
export function safeStyle(value) {
  return String(value ?? "")
    .split(";")
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon === -1) return null;
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const setting = declaration.slice(colon + 1).trim();
      if (!name || !setting) return null;
      if (!propertyAllowed(name) || UNSAFE_CSS_VALUE.test(setting)) return null;
      return `${name}: ${setting}`;
    })
    .filter(Boolean)
    .join("; ");
}

/**
 * Teach a DOMPurify instance to run every surviving `style` through safeStyle().
 *
 * DOMPurify decides whether an attribute may exist; it does not read what is
 * inside this one. Call once per instance. Abstracts are unaffected — their
 * allowlist has no `style`, so the hook finds nothing to do.
 */
export function installStyleFilter(purify) {
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (!node.hasAttribute?.("style")) return;
    const kept = safeStyle(node.getAttribute("style"));
    if (kept) node.setAttribute("style", kept);
    else node.removeAttribute("style");
  });
  return purify;
}

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
