// Where to send someone once they have signed in.
//
// The home page's "Submit an abstract" button points at a page that requires an
// account, so requireUser() has to carry the destination through login and
// registration and come back to it. That destination arrives as a query
// parameter, which means it arrives from whoever wrote the link — including a
// stranger's — so it is validated here rather than trusted.

// One page of this site, optionally with a fragment. Deliberately narrow: no
// scheme, no host, no slash, so "//evil.example" and "https://evil.example"
// both fail. An open redirect is not worth the convenience of a looser rule.
const TARGET = /^[a-z0-9-]+\.html(?:#[a-z0-9_-]+)?$/i;

/** The validated `next` target, or null if it is missing or not one of ours. */
export function safeNext(value) {
  const text = String(value ?? "").trim();
  return TARGET.test(text) ? text : null;
}

/**
 * Resolve where to go after signing in: the requested page if it survived
 * validation, otherwise the console the person belongs in.
 */
export function destinationAfterAuth(next, { isAdmin = false } = {}) {
  return safeNext(next) ?? (isAdmin ? "admin.html" : "account.html");
}

/** Build the `next` value for the page asking for a sign-in. `file` + `hash`. */
export function nextValue(file, hash = "") {
  return safeNext(`${file}${hash}`);
}

/** Append a validated `next` to a URL, dropping it when there is nothing to carry. */
export function withNext(href, next) {
  const clean = safeNext(next);
  return clean ? `${href}?next=${encodeURIComponent(clean)}` : href;
}
